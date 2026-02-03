import { logger } from "@bonsai/shared";

const log = logger();

/**
 * Redis Streams consumer group이 없으면 생성한다.
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {string} params.streamKey
 * @param {string} params.group
 * @returns {Promise<void>}
 */
async function ensureGroup({ redis, streamKey, group }) {
    try {
        await redis.xGroupCreate(streamKey, group, "$", { MKSTREAM: true });
        log.info(`[master:redis] group 생성 stream=${streamKey} group=${group}`);
    } catch (err) {
        const msg = err?.message ?? String(err);
        if (msg.includes("BUSYGROUP")) return;
        log.warn(`[master:redis] group 생성 실패 stream=${streamKey} group=${group} err=${msg}`);
        throw err;
    }
}

/**
 * Redis Streams(result)를 소비한다.
 * - stream: bonsai:result
 * - consumer group 기반
 * - 메시지 검증 후 onResult(resultEnv)로 넘긴다.
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {(resultEnvelope:any)=>Promise<void>} params.onResult
 * @param {AbortSignal} [params.signal]
 * @param {string} [params.group]
 * @param {string} [params.consumer]
 * @param {string} [params.streamKey]
 * @returns {Promise<void>}
 */
export async function runRedisStreamsResultConsumer({
    redis,
    onResult,
    signal,
    group = "bonsai-master",
    consumer = `m-${process.pid}`,
    streamKey = "bonsai:result",
}) {
    if (typeof onResult !== "function") throw new Error("onResult 콜백이 필요합니다.");

    await ensureGroup({ redis, streamKey, group });

    log.info(
        `[master:redis] result consume 시작 stream=${streamKey} group=${group} consumer=${consumer}`
    );

    while (!signal?.aborted) {
        try {
            const res = await redis.xReadGroup(group, consumer, [{ key: streamKey, id: ">" }], {
                COUNT: 10,
                BLOCK: 5000,
            });

            if (!res || res.length === 0) continue;

            for (const stream of res) {
                for (const m of stream.messages ?? []) {
                    const entryId = m.id;
                    const payloadText = String(m.message?.payload ?? "").trim();

                    let result = null;
                    try {
                        result = JSON.parse(payloadText);
                    } catch {
                        log.warn(
                            `[master:redis] result JSON 파싱 실패 entryId=${entryId} payload=${payloadText.slice(0, 200)}`
                        );
                        await redis.xAck(streamKey, group, entryId);
                        continue;
                    }

                    if (!result || result.type !== "result" || !result.inReplyTo) {
                        log.warn(`[master:redis] result 형식 이상 entryId=${entryId}`);
                        await redis.xAck(streamKey, group, entryId);
                        continue;
                    }

                    log.info(
                        `[master:redis] result 수신 entryId=${entryId} inReplyTo=${result.inReplyTo} ok=${result.ok}`
                    );

                    try {
                        await onResult(result);
                    } catch (err) {
                        // onResult 실패는 “처리 실패”이지만, 지금 단계에선 ACK해서 중복 폭탄을 막는다.
                        log.warn(
                            `[master:redis] onResult 처리 실패 entryId=${entryId} err=${err?.message ?? String(err)}`
                        );
                    }

                    await redis.xAck(streamKey, group, entryId);
                }
            }
        } catch (err) {
            const msg = err?.message ?? String(err);

            if (msg.includes("NOGROUP")) {
                log.warn(`[master:redis] NOGROUP 감지 - group 재생성 시도: ${msg}`);
                await ensureGroup({ redis, streamKey, group });
                continue;
            }

            log.warn(`[master:redis] result consume 루프 오류: ${msg}`);
        }
    }

    log.info("[master:redis] result consume 종료");
}
