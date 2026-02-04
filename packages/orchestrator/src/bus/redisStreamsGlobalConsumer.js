import { buildResultEnvelope, logger } from "@bonsai/shared";
import { getGlobalCommandMap } from "../commands/index.js";

const commandMap = getGlobalCommandMap();

async function ensureGroup({ redis, streamKey, group }) {
    const log = logger();

    try {
        await redis.xGroupCreate(streamKey, group, "$", { MKSTREAM: true });
        log.info(`[global:redis] group 생성 stream=${streamKey} group=${group}`);
    } catch (err) {
        const msg = err?.message ?? String(err);
        if (msg.includes("BUSYGROUP")) return;
        log.warn(`[global:redis] group 생성 실패 stream=${streamKey} group=${group} err=${msg}`);
        throw err;
    }
}

/**
 * Redis Streams에서 글로벌 cmd를 소비한다.
 * - stream: bonsai:cmd:__global__
 * - group: bonsai-global
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {AbortSignal} [params.signal]
 * @param {string} [params.group]
 * @param {string} [params.consumer]
 * @returns {Promise<void>}
 */
export async function runRedisStreamsGlobalConsumer({
    redis,
    signal,
    group = "bonsai-global",
    consumer = `g-${process.pid}`,
}) {
    const log = logger();

    const tenantKey = "__global__";
    const streamKey = `bonsai:cmd:${tenantKey}`;
    const resultStreamKey = "bonsai:result";

    await ensureGroup({ redis, streamKey, group });

    log.info(`[global:redis] consume 시작 stream=${streamKey} group=${group} consumer=${consumer}`);

    while (!signal?.aborted) {
        try {
            const res = await redis.xReadGroup(group, consumer, [{ key: streamKey, id: ">" }], {
                COUNT: 10,
                BLOCK: 5000,
            });

            if (!res || res.length === 0) continue;

            for (const stream of res) {
                const messages = stream.messages ?? [];
                for (const m of messages) {
                    const entryId = m.id;
                    const payloadText = String(m.message?.payload ?? "").trim();

                    let envelope = null;
                    try {
                        envelope = JSON.parse(payloadText);
                    } catch {
                        log.error(
                            `[global:redis] payload JSON 파싱 실패 entryId=${entryId} payload=${payloadText.slice(
                                0,
                                300
                            )}`
                        );
                    }

                    if (!envelope || envelope.type !== "cmd") {
                        await redis.xAck(streamKey, group, entryId);
                        continue;
                    }

                    if (String(envelope.tenantKey ?? "").trim() !== tenantKey) {
                        log.warn(
                            `[global:redis] tenantKey 불일치로 무시 entryId=${entryId} got=${envelope.tenantKey} expected=${tenantKey}`
                        );
                        await redis.xAck(streamKey, group, entryId);
                        continue;
                    }

                    log.info(
                        `[global:redis] cmd 수신 entryId=${entryId} envelopeId=${envelope.id} cmd=${envelope.cmd}`
                    );

                    const receivedAtMs = Date.now();
                    const startNs = process.hrtime.bigint();

                    let execOk = false;
                    let execData = null;

                    try {
                        const cmdName = String(envelope.cmd ?? "").trim();
                        const def = commandMap.get(cmdName);

                        if (!cmdName) {
                            execOk = false;
                            execData = { error: "cmd가 비어있음" };
                        } else if (!def || typeof def.execute !== "function") {
                            execOk = false;
                            execData = { error: `unknown cmd: ${cmdName}` };
                        } else {
                            const ctx = { redis, log, commandMap };
                            const res = await def.execute(ctx, envelope);
                            execOk = Boolean(res?.ok);
                            execData = res?.data ?? null;
                        }
                    } catch (err) {
                        execOk = false;
                        execData = { error: err?.message ?? String(err) };
                    }

                    const endNs = process.hrtime.bigint();
                    const handlerMs = Number(endNs - startNs) / 1_000_000;
                    const finishedAtMs = Date.now();
                    const totalMs = Math.max(0, finishedAtMs - receivedAtMs);

                    log.info(
                        `[global:redis] 처리 완료 envelopeId=${String(envelope.id ?? "")} cmd=${String(
                            envelope.cmd ?? ""
                        )} ok=${execOk} handlerMs=${handlerMs.toFixed(2)} totalMs=${totalMs}`
                    );

                    // replyTo가 없는 cmd여도, 관측을 위해 result는 동일 스트림에 남겨둔다.
                    const resultEnv = buildResultEnvelope({
                        inReplyTo: String(envelope.id),
                        ok: execOk,
                        data: execData,
                        meta: {
                            tenantKey,
                            scope: "global",
                            cmd: envelope.cmd,
                            issuedAt: Math.floor(Date.now() / 1000),
                        },
                    });

                    await redis.xAdd(resultStreamKey, "*", { payload: JSON.stringify(resultEnv) });
                    await redis.xAck(streamKey, group, entryId);
                }
            }
        } catch (err) {
            const msg = err?.message ?? String(err);

            if (msg.includes("NOGROUP")) {
                log.warn(`[global:redis] NOGROUP 감지 - group 재생성 시도: ${msg}`);
                try {
                    await ensureGroup({ redis, streamKey, group });
                    log.info(`[global:redis] group 재생성 완료 stream=${streamKey} group=${group}`);
                    continue;
                } catch (e) {
                    log.warn(`[global:redis] group 재생성 실패: ${e?.message ?? String(e)}`);
                }
            }

            log.warn(`[global:redis] consume 루프 오류: ${msg}`);
        }
    }

    log.info(`[global:redis] consume 종료 stream=${streamKey}`);
}
