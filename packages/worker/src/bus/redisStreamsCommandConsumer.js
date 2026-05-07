import { buildResultEnvelope, logger, publishToGlobalCmdStream } from "@bonsai/shared";
import { getCommandMap } from "../commands/index.js";

const commandMap = getCommandMap();

/** 전역 1회 처리 대상(시세 등). Tenant Worker는 실행하지 않고 bonsai:cmd:global로 재발행만 한다. */
const GLOBAL_MARKET_COMMANDS = Object.freeze(["시세"]);

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
 * @param {import("@prisma/client").PrismaClient} [params.prisma]
 * @param {string} params.tenantKey
 * @param {AbortSignal} [params.signal]
 * @param {string} [params.group]
 * @param {string} [params.consumer]
 * @returns {Promise<void>}
 */
export async function runRedisStreamsCommandConsumer({
    redis,
    prisma,
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
            // 1. DLQ: 10초 이상 방치된 메시지 최대 1개 회수
            let messagesToProcess = [];
            try {
                const autoClaimRes = await redis.xAutoClaim(streamKey, group, consumer, 10000, "0-0", { COUNT: 1 });
                const recoveredMessages = autoClaimRes?.messages || [];

                for (const m of recoveredMessages) {
                    const pendingInfo = await redis.xPendingRange(streamKey, group, m.id, m.id, 1);
                    const deliveryCount = pendingInfo?.[0]?.deliveriesCounter ?? 1;

                    if (deliveryCount >= 2) {
                        log.warn(
                            `[DLQ] 독약 메시지 감지 및 영구 폐기. tenant=${t} entryId=${m.id} payload=${m.message?.payload} deliveryCount=${deliveryCount}`
                        );
                        await redis.xAck(streamKey, group, m.id);
                    } else {
                        log.error(
                            `[DLQ] 미처리 메시지 회수 및 재시도 (1회 실패). tenant=${t} entryId=${m.id} deliveryCount=${deliveryCount}`
                        );
                        messagesToProcess.push(m);
                    }
                }
            } catch (err) {
                log.error(`[worker:redis] xAutoClaim 실패: ${err?.message ?? String(err)}`);
            }

            // 2. 새 메시지 대기 (회수된 메시지가 있으면 즉시 반환되도록 BLOCK 1ms 적용)
            const blockTime = messagesToProcess.length > 0 ? 1 : 5000;
            const res = await redis.xReadGroup(group, consumer, [{ key: streamKey, id: ">" }], {
                COUNT: 1, // Blast Radius 격리를 위해 1로 축소
                BLOCK: blockTime,
            });

            if (res && res.length > 0) {
                for (const stream of res) {
                    if (stream.messages) {
                        messagesToProcess.push(...stream.messages);
                    }
                }
            }

            if (messagesToProcess.length === 0) continue;

            // 기존 중첩 루프 호환을 위한 가짜(Synthetic) stream 객체 배열
            const syntheticRes = [{ messages: messagesToProcess }];

            for (const stream of syntheticRes) {
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

                    const cmdName = String(envelope.cmd ?? "").trim();
                    // 전역 시세: Tenant가 받으면 global 스트림으로 재발행 후 종료(무한 루프 방지: scope=global이면 Global Worker가 실행만 함)
                    if (
                        t !== "global" &&
                        GLOBAL_MARKET_COMMANDS.includes(cmdName) &&
                        envelope.scope !== "global"
                    ) {
                        try {
                            await publishToGlobalCmdStream({ redis, envelope });
                            await redis.xAck(streamKey, group, entryId);
                        } catch (err) {
                            log.error(
                                `[worker:redis] global 재발행 실패 entryId=${entryId} cmd=${cmdName}`,
                                err
                            );
                            const resultEnv = buildResultEnvelope({
                                inReplyTo: String(envelope.id),
                                ok: false,
                                data: { error: "전역 시세 라우팅 실패" },
                                meta: { tenantKey: t, cmd: envelope.cmd },
                            });
                            await redis.xAdd(resultStreamKey, "*", {
                                payload: JSON.stringify(resultEnv),
                            });
                            await redis.xAck(streamKey, group, entryId);
                        }
                        continue;
                    }

                    // --- commandMap 기반 디스패치 ---

                    const receivedAtMs = Date.now();
                    const issuedAtSec = Number(envelope?.meta?.issuedAt);
                    const issuedAtMs = Number.isFinite(issuedAtSec) ? issuedAtSec * 1000 : null;

                    const startNs = process.hrtime.bigint();

                    let res;
                    let execOk = false;
                    let execData = null;

                    try {
                        const def = commandMap.get(cmdName);

                        if (!cmdName) {
                            execOk = false;
                            execData = { error: "cmd가 비어있음" };
                        } else if (!def || typeof def.execute !== "function") {
                            execOk = false;
                            execData = { error: `unknown cmd: ${cmdName}` };
                        } else {
                            const baseCtx = {
                                redis,
                                prisma,
                                tenantKey: t,
                                log,
                                commandMap,
                            };

                            // ✅ metrics는 command가 "표시할지 말지" 선택하도록 ctx에만 준다
                            baseCtx.metrics = {
                                issuedAtMs,
                                workerReceivedAtMs: receivedAtMs,
                                // 아래 3개는 execute 이후에 채워 넣는다
                                workerFinishedAtMs: null,
                                discordToWorkerReceiveMs:
                                    issuedAtMs == null
                                        ? null
                                        : Math.max(0, receivedAtMs - issuedAtMs),
                                workerHandlerMs: null,
                                workerTotalMs: null,
                            };

                            res = await def.execute(baseCtx, envelope);

                            execOk = Boolean(res?.ok);
                            execData = res?.data ?? null;

                            // command가 metrics를 data에 붙이든 말든, consumer는 간섭 안 함
                        }
                    } catch (err) {
                        execOk = false;
                        execData = { error: err?.message ?? String(err) };
                    }

                    const endNs = process.hrtime.bigint();
                    const handlerMs = Number(endNs - startNs) / 1_000_000;
                    const finishedAtMs = Date.now();
                    const totalMs = Math.max(0, finishedAtMs - receivedAtMs);

                    if (!execOk) {
                        log.info(
                            `[worker:redis] 실패 tenant=${t} envelopeId=${String(envelope.id ?? "")} cmd=${String(
                                envelope.cmd ?? ""
                            )} reason=${safeStringify(execData)}`
                        );
                    }

                    log.info(
                        `[worker:redis] 처리 완료 tenant=${t} envelopeId=${String(envelope.id ?? "")} cmd=${String(
                            envelope.cmd ?? ""
                        )} ok=${execOk} handlerMs=${handlerMs.toFixed(2)} totalMs=${totalMs}`
                    );

                    const baseMeta = {
                        tenantKey: t,
                        cmd: envelope.cmd,
                        issuedAt: Math.floor(Date.now() / 1000),
                        workerReceivedAtMs: receivedAtMs,
                        workerFinishedAtMs: finishedAtMs,
                    };
                    const resMeta = res?.meta && typeof res.meta === "object" ? res.meta : {};
                    const resultEnv = buildResultEnvelope({
                        inReplyTo: String(envelope.id),
                        ok: execOk,
                        data: execData,
                        meta: { ...baseMeta, ...resMeta },
                    });

                    await redis.xAdd(resultStreamKey, "*", { payload: JSON.stringify(resultEnv) });
                    await redis.xAck(streamKey, group, entryId);
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
                    log.warn(
                        `[worker:redis] group 재생성 실패 - 서버 종료: ${e?.message ?? String(e)}`
                    );
                    process.exit(1);
                }
            }

            log.warn(`[worker:redis] consume 루프 오류: ${msg}`);
        }
    }

    log.info(`[worker:redis] consume 종료 tenant=${t}`);
}

function safeStringify(v) {
    try {
        if (v == null) return "(no data)";
        const s = JSON.stringify(v);
        return s.length > 1800 ? `${s.slice(0, 1800)}…` : s;
    } catch {
        return String(v);
    }
}
