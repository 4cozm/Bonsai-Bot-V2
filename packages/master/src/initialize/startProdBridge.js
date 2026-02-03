// packages/master/src/initialize/startProdBridge.js
import { logger } from "@bonsai/shared";
import { runRedisStreamsResultConsumer } from "../bus/redisStreamsResultConsumer.js";

const log = logger();

/**
 * Prod Master:
 * - Redis Streams(result) 소비 → pendingMap 매칭 → Discord editReply 종료
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {Map<string, any>} params.pendingMap
 * @param {AbortSignal} [params.signal]
 */
export async function startProdBridge({ redis, pendingMap, signal } = {}) {
    if (!redis) throw new Error("redis 주입이 필요합니다.");
    if (!pendingMap || typeof pendingMap.get !== "function") {
        throw new Error("pendingMap(Map)이 필요합니다.");
    }

    log.info("[prodBridge] 시작: Redis Streams(result) 소비");

    await runRedisStreamsResultConsumer({
        redis,
        signal,
        group: "bonsai-prodmaster",
        consumer: `prodmaster-${process.pid}`,
        onResult: async (resultEnv) => {
            const inReplyTo = String(resultEnv?.inReplyTo ?? "").trim();
            if (!inReplyTo) return;

            const pending = pendingMap.get(inReplyTo);
            if (!pending) {
                log.info(`[prodBridge] pending 없음 inReplyTo=${inReplyTo} (대기/유실 가능)`);
                return;
            }

            pendingMap.delete(inReplyTo);

            const interaction = pending.interaction ?? pending;
            if (!interaction?.editReply) {
                log.warn(`[prodBridge] interaction.editReply 없음 inReplyTo=${inReplyTo}`);
                return;
            }

            const ok = Boolean(resultEnv?.ok);
            const data = resultEnv?.data ?? null;

            const content = ok
                ? `${safeStringify(data)}`
                : `❌ 처리 실패\n${safeStringify(data)}`;

            await interaction.editReply({ content });
            log.info(`[prodBridge] Discord 응답 완료 inReplyTo=${inReplyTo} ok=${ok}`);
        },
    });
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
