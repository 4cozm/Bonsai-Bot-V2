import { logger } from "@bonsai/shared";

const log = logger();

/**
 * cmd envelope를 tenant stream(bonsai:cmd:{tenantKey})에 XADD 한다.
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {any} params.envelope
 * @returns {Promise<string>} redis entry id
 */
export async function publishCmdToRedisStream({ redis, envelope }) {
    const tenantKey = String(envelope?.tenantKey ?? "").trim();
    if (!tenantKey) throw new Error("tenantKey가 비어있습니다.");

    const streamKey = `bonsai:cmd:${tenantKey}`;
    const payload = JSON.stringify(envelope);

    const id = await redis.xAdd(streamKey, "*", { payload });

    log.info(
        `[devBridge] streams publish ok stream=${streamKey} entryId=${id} envelopeId=${envelope?.id ?? ""} cmd=${envelope?.cmd ?? ""}`
    );

    return id;
}
