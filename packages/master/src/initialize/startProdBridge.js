// packages/master/src/initialize/startProdBridge.js
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { logger } from "@bonsai/shared";
import { runRedisStreamsResultConsumer } from "../bus/redisStreamsResultConsumer.js";

const log = logger();

/**
 * Prod Master 결과 수신기:
 * - Redis Streams(result) 소비 → pendingMap 매칭 → Discord editReply 종료
 * - SQS(result) 폴링(주로 devBridge 경유 결과) → pendingMap 매칭 → Discord editReply 종료
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {Map<string, any>} params.pendingMap
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<void>}
 */
export async function startProdBridge({ redis, pendingMap, signal } = {}) {
    if (!redis) throw new Error("redis 주입이 필요합니다.");
    if (!pendingMap || typeof pendingMap.get !== "function") {
        throw new Error("pendingMap(Map)이 필요합니다.");
    }

    // ✅ Redis 결과 소비는 항상 켠다 (prod ping 경로)
    const redisLoop = runRedisStreamsResultConsumer({
        redis,
        signal,
        group: "bonsai-prodmaster",
        consumer: `prodmaster-${process.pid}`,
        onResult: async (resultEnv) => {
            await handleResult({ resultEnv, pendingMap, source: "redis" });
        },
    });

    // ✅ SQS 결과 폴링은 설정이 있을 때만 켠다 (devBridge 결과 경로)
    const sqsEnabled =
        String(process.env.AWS_REGION ?? "").trim() &&
        String(process.env.PROD_SQS_RESULT_QUEUE_URL ?? "").trim();

    const sqsLoop = sqsEnabled
        ? startSqsResultPolling({ pendingMap, signal })
        : (async () => {
              log.info(
                  "[prodBridge] SQS(result) 비활성: AWS_REGION/PROD_SQS_RESULT_QUEUE_URL 없음"
              );
          })();

    log.info("[prodBridge] 시작: Redis(result) + SQS(result) 수신");

    // 두 루프 모두 “끝날 때까지” 유지
    await Promise.allSettled([redisLoop, sqsLoop]);

    log.info("[prodBridge] 종료");
}

/**
 * SQS(result) 폴링 루프.
 * - pending 없음이면 삭제하지 않는다(유실 방지)
 *
 * @param {object} params
 * @param {Map<string, any>} params.pendingMap
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<void>}
 */
async function startSqsResultPolling({ pendingMap, signal } = {}) {
    const region = String(process.env.AWS_REGION ?? "").trim();
    const queueUrl = String(process.env.PROD_SQS_RESULT_QUEUE_URL ?? "").trim();

    if (!region) throw new Error("AWS_REGION이 비어있습니다.");
    if (!queueUrl) throw new Error("PROD_SQS_RESULT_QUEUE_URL이 비어있습니다.");

    const sqs = new SQSClient({ region });

    log.info(`[prodBridge] SQS(result) 폴링 시작 queueUrl=${queueUrl}`);

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

                const { ok, resultEnv, reason } = parseSqsBodyToResultEnvelope(body);

                // 파싱 자체가 실패(형식 불명/깨짐)면 삭제해서 큐를 정리한다.
                if (!ok) {
                    log.warn(`[prodBridge] SQS 메시지 파싱 실패(삭제) reason=${reason}`);
                    if (receipt) {
                        await sqs.send(
                            new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt })
                        );
                    }
                    continue;
                }

                const handled = await handleResult({
                    resultEnv,
                    pendingMap,
                    source: "sqs",
                });

                if (handled && receipt) {
                    await sqs.send(
                        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt })
                    );
                }
            }
        } catch (e) {
            if (signal?.aborted) break;
            log.warn("[prodBridge] SQS 폴링/처리 중 오류", e);
        }
    }

    log.info("[prodBridge] SQS(result) 폴링 종료");
}

/**
 * resultEnv를 pendingMap과 매칭해 Discord 응답을 닫는다.
 *
 * @param {object} params
 * @param {any} params.resultEnv
 * @param {Map<string, any>} params.pendingMap
 * @param {"redis"|"sqs"} params.source
 * @returns {Promise<boolean>} handled(=pending 매칭되어 최종 응답까지 완료했는지)
 */
async function handleResult({ resultEnv, pendingMap, source }) {
    const inReplyTo = String(resultEnv?.inReplyTo ?? "").trim();
    if (!inReplyTo) {
        log.info(`[prodBridge] inReplyTo 없음 source=${source}`);
        return false;
    }

    const pending = pendingMap.get(inReplyTo);
    if (!pending) {
        // Redis는 ACK되면서 흘러가고, SQS는 삭제하지 않으면 재수신됨.
        log.info(`[prodBridge] pending 없음 source=${source} inReplyTo=${inReplyTo}`);
        return false;
    }

    // 중복 처리 방지
    pendingMap.delete(inReplyTo);

    const interaction = pending.interaction ?? pending;
    if (!interaction?.editReply) {
        log.warn(`[prodBridge] interaction.editReply 없음 source=${source} inReplyTo=${inReplyTo}`);
        return false;
    }

    const ok = Boolean(resultEnv?.ok);
    const data = resultEnv?.data ?? null;

    const content = ok ? `${safeStringify(data)}` : `❌ 처리 실패\n${safeStringify(data)}`;

    await interaction.editReply({ content });

    log.info(`[prodBridge] Discord 응답 완료 source=${source} inReplyTo=${inReplyTo} ok=${ok}`);
    return true;
}

/**
 * SQS Body는 "원시 result envelope JSON"으로 온다.
 * 예: {"type":"result","inReplyTo":"...","ok":true,"data":...}
 *
 * @param {string} body
 * @returns {{ok:true, resultEnv:any} | {ok:false, reason:string}}
 */
function parseSqsBodyToResultEnvelope(body) {
    const raw = String(body ?? "").trim();
    if (!raw) return { ok: false, reason: "empty body" };

    let j;
    try {
        j = JSON.parse(raw);
    } catch {
        return { ok: false, reason: "body not json" };
    }

    // 최소 계약만 확인 (type/result, inReplyTo)
    const type = String(j?.type ?? "").trim();
    const inReplyTo = String(j?.inReplyTo ?? "").trim();

    if (type !== "result") return { ok: false, reason: `invalid type: ${type || "(empty)"}` };
    if (!inReplyTo) return { ok: false, reason: "missing inReplyTo" };

    return { ok: true, resultEnv: j };
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
