import { logger } from "@bonsai/shared";
import { createClient } from "redis";

const log = logger();

/**
 * Redis client를 생성/연결한다.
 *
 * @param {object} [opts]
 * @param {string} [opts.url] - 기본: process.env.REDIS_URL || "redis://127.0.0.1:6379"
 * @returns {Promise<import("redis").RedisClientType>}
 */
export async function createRedisClient(opts = {}) {
    const url = String(opts.url ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379").trim();

    const client = createClient({ url });

    client.on("error", (err) => {
        log.warn(`[redis] client error: ${err?.message ?? String(err)}`);
    });

    await client.connect();
    log.info(`[redis] connected url=${url}`);

    return client;
}
