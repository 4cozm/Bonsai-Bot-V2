import { buildResultEnvelope, logger } from "@bonsai/shared";
import { getCommandMap } from "../commands/index.js";
const commandMap = getCommandMap();

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
    const log = logger();

    try {
        // MKSTREAM: 스트림이 없어도 그룹 생성
        await redis.xGroupCreate(streamKey, group, "$", { MKSTREAM: true });
        log.info(`[worker:redis] group 생성 stream=${streamKey} group=${group}`);
    } catch (err) {
        const msg = err?.message ?? String(err);
        // BUSYGROUP은 이미 그룹이 존재한다는 의미
        if (msg.includes("BUSYGROUP")) return;
        log.warn(`[worker:redis] group 생성 실패 stream=${streamKey} group=${group} err=${msg}`);
        throw err;
    }
}

/**
 * Redis Streams에서 tenant cmd를 소비한다.
 * - stream: bonsai:cmd:{tenantKey}
 * - group: 고정 그룹명 (예: bonsai-worker)
 * - consumer: 인스턴스 식별자
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {string} params.tenantKey
 * @param {AbortSignal} [params.signal]
 * @param {string} [params.group]
 * @param {string} [params.consumer]
 * @returns {Promise<void>}
 */
export async function runRedisStreamsCommandConsumer({
    redis,
    tenantKey,
    signal,
    group = "bonsai-worker",
    consumer = `c-${process.pid}`,
}) {
    const log = logger();

    const t = String(tenantKey ?? "").trim();
    if (!t) throw new Error("tenantKey가 비어있습니다.");

    const streamKey = `bonsai:cmd:${t}`;
    const resultStreamKey = "bonsai:result";

    await ensureGroup({ redis, streamKey, group });

    log.info(
        `[worker:redis] consume 시작 tenant=${t} stream=${streamKey} group=${group} consumer=${consumer}`
    );

    while (!signal?.aborted) {
        try {
            // BLOCK으로 대기하되, 무한 블락 대신 5초 단위로 끊어서 abort를 반영한다.
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
                            `[worker:redis] payload JSON 파싱 실패 tenant=${t} entryId=${entryId} payload=${payloadText.slice(0, 300)}`
                        );
                    }

                    if (!envelope || envelope.type !== "cmd") {
                        // 잘못된 메시지는 일단 ACK해서 썩지 않게 한다(지금 단계에선)
                        await redis.xAck(streamKey, group, entryId);
                        continue;
                    }

                    // tenantKey mismatch는 논리상 없어야 하지만 방어
                    if (String(envelope.tenantKey ?? "").trim() !== t) {
                        log.warn(
                            `[worker:redis] tenantKey 불일치로 무시 entryId=${entryId} got=${envelope.tenantKey} expected=${t}`
                        );
                        await redis.xAck(streamKey, group, entryId);
                        continue;
                    }

                    log.info(
                        `[worker:redis] cmd 수신 tenant=${t} entryId=${entryId} envelopeId=${envelope.id} cmd=${envelope.cmd}`
                    );

                    // --- commandMap 기반 디스패치 ---
                    let ok = true;
                    let data = null;

                    try {
                        const cmdName = String(envelope.cmd ?? "").trim();
                        const def = commandMap.get(cmdName);

                        if (!def) {
                            ok = false;
                            data = { error: `알 수 없는 커맨드: ${cmdName}` };
                        } else if (typeof def.execute !== "function") {
                            ok = false;
                            data = { error: `커맨드 핸들러 없음: ${cmdName}` };
                        } else {
                            // handler는 "도메인 결과"만 반환: { ok, data }
                            const res = await def.execute(
                                {
                                    redis,
                                    tenantKey: t,
                                    log,
                                    commandMap,
                                },
                                envelope
                            );

                            ok = Boolean(res?.ok);
                            data = res?.data ?? null;
                        }
                    } catch (err) {
                        ok = false;
                        data = { error: err?.message ?? String(err) };
                    }

                    // result publish
                    const resultEnv = buildResultEnvelope({
                        inReplyTo: String(envelope.id),
                        ok,
                        data,
                        meta: {
                            tenantKey: t,
                            cmd: envelope.cmd,
                            issuedAt: Math.floor(Date.now() / 1000),
                        },
                    });

                    await redis.xAdd(resultStreamKey, "*", { payload: JSON.stringify(resultEnv) });

                    // 처리 완료 후 ACK
                    await redis.xAck(streamKey, group, entryId);

                    log.info(
                        `[worker:redis] 처리 완료 tenant=${t} entryId=${entryId} inReplyTo=${resultEnv.inReplyTo} ok=${ok}`
                    );
                }
            }
        } catch (err) {
            const msg = err?.message ?? String(err);

            // Redis 재시작/키 삭제 등으로 group이 사라진 케이스 자동 복구
            if (msg.includes("NOGROUP")) {
                log.warn(`[worker:redis] NOGROUP 감지 - group 재생성 시도: ${msg}`);
                try {
                    await ensureGroup({ redis, streamKey, group });
                    log.info(`[worker:redis] group 재생성 완료 stream=${streamKey} group=${group}`);
                    continue;
                } catch (e) {
                    log.warn(`[worker:redis] group 재생성 실패: ${e?.message ?? String(e)}`);
                }
            }

            log.warn(`[worker:redis] consume 루프 오류: ${msg}`);
        }
    }

    log.info(`[worker:redis] consume 종료 tenant=${t}`);
}
