//\packages\master\src\bus\runDevSqsCommandConsumer.js

import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { logger } from "@bonsai/shared";

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Dev Master가 SQS에서 cmd envelope를 소비한다.
 * - SQS는 raw message delivery 전제(Body가 envelope JSON)
 * - worker로 넘기기 전에 여기서 tenantKey 스트림으로 라우팅한다(onCmd 콜백)
 *
 * @param {object} params
 * @param {string} params.queueUrl
 * @param {string} params.region
 * @param {string} params.devKey
 * @param {(envelope: any) => Promise<void>} params.onCmd
 * @param {AbortSignal} [params.signal]
 */
export async function runSqsCommandConsumer({ queueUrl, region, devKey, onCmd, signal }) {
    const log = logger();
    const sqs = new SQSClient({ region });

    log.info(`[devSqs] 소비 시작 queueUrl=${queueUrl} devKey=${devKey}`);

    while (!signal?.aborted) {
        try {
            const res = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: queueUrl,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 20,
                    VisibilityTimeout: 30,
                })
            );

            const msgs = res.Messages ?? [];
            if (msgs.length === 0) continue;

            for (const msg of msgs) {
                const receiptHandle = msg.ReceiptHandle;
                const messageId = msg.MessageId;

                const payloadText = String(msg.Body ?? "").trim();
                const payload = safeJsonParse(payloadText);

                if (!payload) {
                    log.warn(
                        `[devSqs] JSON 파싱 실패 messageId=${messageId} body=${payloadText.slice(0, 500)}`
                    );
                    if (receiptHandle) {
                        await sqs.send(
                            new DeleteMessageCommand({
                                QueueUrl: queueUrl,
                                ReceiptHandle: receiptHandle,
                            })
                        );
                    }
                    continue;
                }

                const rawTarget = payload?.targetDev;
                const targets = Array.isArray(rawTarget)
                    ? rawTarget.map((v) => String(v).trim()).filter(Boolean)
                    : rawTarget
                      ? [String(rawTarget).trim()]
                      : [];

                const isMine = targets.length === 0 || targets.includes(String(devKey).trim());
                if (!isMine) {
                    log.info(
                        `[devSqs] targetDev 불일치로 무시 messageId=${messageId} targets=${targets.join(",")} devKey=${devKey}`
                    );
                    if (receiptHandle) {
                        await sqs.send(
                            new DeleteMessageCommand({
                                QueueUrl: queueUrl,
                                ReceiptHandle: receiptHandle,
                            })
                        );
                    }
                    continue;
                }

                log.info(
                    `[devSqs] cmd 수신 messageId=${messageId} tenantKey=${payload?.tenantKey} cmd=${payload?.cmd}`
                );

                // ✅ 여기서 Redis Streams로 라우팅(브릿지)
                await onCmd(payload);

                // 브릿지 성공했으면 삭제
                if (receiptHandle) {
                    await sqs.send(
                        new DeleteMessageCommand({
                            QueueUrl: queueUrl,
                            ReceiptHandle: receiptHandle,
                        })
                    );
                }
            }
        } catch (err) {
            log.warn(`[devSqs] 소비 루프 오류: ${err?.message ?? String(err)}`);
        }
    }

    log.info("[devSqs] 소비 종료");
}
