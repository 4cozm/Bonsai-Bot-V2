// packages/master/src/initialize/startProdBridge.js
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { logger } from "@bonsai/shared";

const log = logger();

/**
 * Prod Master 브릿지:
 * - SQS(result) 구독/폴링 → pendingMap 매칭 → Discord editReply로 응답 종료
 *
 * @param {object} params
 * @param {Map<string, any>} params.pendingMap inReplyTo(envelopeId) -> pendingCtx({interaction,...})
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<void>}
 */
export async function startProdBridge({ pendingMap, signal } = {}) {
    if (!pendingMap || typeof pendingMap.get !== "function") {
        throw new Error("pendingMap(Map)이 필요합니다.");
    }

    const region = String(process.env.AWS_REGION ?? "").trim();
    const queueUrl = String(process.env.PROD_SQS_RESULT_QUEUE_URL ?? "").trim();

    if (!region) throw new Error("AWS_REGION이 비어있습니다.");
    if (!queueUrl) throw new Error("PROD_SQS_RESULT_QUEUE_URL이 비어있습니다.");

    const sqs = new SQSClient({ region });

    log.info(`[prodBridge] 시작: SQS(result) 폴링 queueUrl=${queueUrl}`);

    while (!signal?.aborted) {
        try {
            const resp = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: queueUrl,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 20, // long polling
                    MessageAttributeNames: ["All"],
                    AttributeNames: ["All"],
                })
            );

            const msgs = resp.Messages ?? [];
            if (msgs.length === 0) continue;

            for (const m of msgs) {
                const receipt = m.ReceiptHandle;
                const body = String(m.Body ?? "");

                // (선택) SNS→SQS라면 MessageAttributes.type 같은 필터가 붙어있을 수 있음
                // const type = m.MessageAttributes?.type?.StringValue;

                let resultEnv;
                try {
                    resultEnv = JSON.parse(body);
                } catch (e) {
                    log.warn("[prodBridge] 메시지 JSON 파싱 실패(삭제)", e);
                    if (receipt) {
                        await sqs.send(
                            new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt })
                        );
                    }
                    continue;
                }

                const inReplyTo = String(resultEnv?.inReplyTo ?? "").trim();
                if (!inReplyTo) {
                    log.info("[prodBridge] inReplyTo 없음(삭제)");
                    if (receipt) {
                        await sqs.send(
                            new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt })
                        );
                    }
                    continue;
                }

                const pending = pendingMap.get(inReplyTo);
                if (!pending) {
                    log.info(`[prodBridge] pending 없음 inReplyTo=${inReplyTo} (삭제)`);
                    if (receipt) {
                        await sqs.send(
                            new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt })
                        );
                    }
                    continue;
                }

                // 중복 처리 방지
                pendingMap.delete(inReplyTo);

                const interaction = pending.interaction ?? pending;
                if (!interaction?.editReply) {
                    log.warn(`[prodBridge] interaction.editReply 없음 inReplyTo=${inReplyTo}`);
                    if (receipt) {
                        await sqs.send(
                            new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt })
                        );
                    }
                    continue;
                }

                const ok = Boolean(resultEnv?.ok);
                const data = resultEnv?.data ?? null;

                const content = ok
                    ? `✅ 처리 완료\n${safeStringify(data)}`
                    : `❌ 처리 실패\n${safeStringify(data)}`;

                await interaction.editReply({ content });

                log.info(`[prodBridge] Discord 응답 완료 inReplyTo=${inReplyTo} ok=${ok}`);

                if (receipt) {
                    await sqs.send(
                        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt })
                    );
                }
            }
        } catch (e) {
            // abort 중이면 조용히 빠져나가고, 그 외는 warn
            if (signal?.aborted) break;
            log.warn("[prodBridge] SQS 폴링/처리 중 오류", e);
        }
    }

    log.info("[prodBridge] 종료");
}

/**
 * @param {any} v
 * @returns {string}
 */
function safeStringify(v) {
    try {
        if (v == null) return "(no data)";
        const s = JSON.stringify(v);
        return s.length > 1800 ? `${s.slice(0, 1800)}…` : s;
    } catch {
        return String(v);
    }
}
