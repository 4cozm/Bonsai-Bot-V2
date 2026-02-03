// packages/master/src/initialize/startProdResultConsumer.js
import { createRedisClient } from "@bonsai/external";
import { logger } from "@bonsai/shared";
import { runRedisStreamsResultConsumer } from "../bus/redisStreamsResultConsumer.js";

const log = logger();

/**
 * Prod Master:
 * - Redis Streams(result)를 소비하고 pendingMap 매칭 후 Discord editReply로 응답을 닫는다.
 *
 * 주의: result consume 로직은 prod/dev 공통(runRedisStreamsResultConsumer)이고,
 *       prod에서는 onResult에서 Discord 응답 마무리로 분기한다.
 *
 * @param {object} params
 * @param {Map<string, any>} params.pendingMap inReplyTo(envelopeId) -> pendingCtx({interaction,...})
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<void>}
 */
export async function startProdResultConsumer({ redis: redisFromCaller, pendingMap, signal } = {}) {
    if (!pendingMap || typeof pendingMap.get !== "function") {
        throw new Error("pendingMap(Map)이 필요합니다.");
    }

    const redis = redisFromCaller ?? (await createRedisClient());
    const ownsRedis = !redisFromCaller;

    log.info("[prodResult] 시작 (Redis result -> Discord editReply)");

    try {
        await runRedisStreamsResultConsumer({
            redis,
            signal,
            group: "bonsai-master",
            consumer: `prodmaster-${process.pid}`,
            onResult: async (resultEnv) => {
                const inReplyTo = String(resultEnv?.inReplyTo ?? "").trim();
                if (!inReplyTo) return;

                const pending = pendingMap.get(inReplyTo);
                if (!pending) {
                    log.info(`[prodResult] pending 없음 inReplyTo=${inReplyTo}`);
                    return;
                }

                // 중복 처리 방지
                pendingMap.delete(inReplyTo);

                const interaction = pending.interaction ?? pending;
                if (!interaction?.editReply) {
                    log.warn(`[prodResult] interaction.editReply 없음 inReplyTo=${inReplyTo}`);
                    return;
                }

                const ok = Boolean(resultEnv?.ok);
                const data = resultEnv?.data ?? null;

                const content = ok
                    ? `✅ 처리 완료\n${safeStringify(data)}`
                    : `❌ 처리 실패\n${safeStringify(data)}`;

                await interaction.editReply({ content });
                log.info(`[prodResult] Discord 응답 완료 inReplyTo=${inReplyTo} ok=${ok}`);
            },
        });
    } finally {
        try {
            if (ownsRedis) await redis.quit();
        } catch {
            // 무시
        }
    }
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
