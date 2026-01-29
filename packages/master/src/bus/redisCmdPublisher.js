import { logger } from "@bonsai/shared";

const log = logger();

/**
 * cmd envelope를 테넌트별 Redis Stream(bonsai:cmd:{tenantKey})에 적재한다.
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {object} params.envelope
 * @param {string} params.envelope.tenantKey
 * @returns {Promise<string>} stream entry id
 */
export async function publishCmdToTenantStream({ redis, envelope }) {
    const tenantKey = String(envelope?.tenantKey ?? "").trim();
    if (!tenantKey) {
        log.error("[redisCmd] tenantKey 누락");
        throw new Error("tenantKey 누락");
    }

    const streamKey = `bonsai:cmd:${tenantKey}`;
    const payloadJson = JSON.stringify(envelope);

    // MAXLEN ~ 로 대충 제한(과거 엔트리 무한 증가 방지)
    const id = await redis.xAdd(
        streamKey,
        "*",
        { payload: payloadJson },
        {
            TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 20000 },
        }
    );

    log.info(`[redisCmd] publish ok stream=${streamKey} id=${id} cmd=${envelope?.cmd ?? ""}`);
    return id;
}
