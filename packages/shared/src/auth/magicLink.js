// packages/shared/src/auth/magicLink.js
// 관리자 로그인용 1회성 매직링크 토큰. /보급 명령(워커)이 발급하고, API 서버가 소비한다 —
// 두 프로세스가 같은 Redis를 봐야 동작한다(REDIS_URL 공용 키).

import { randomUUID } from "node:crypto";

const KEY_PREFIX = "bonsai:api:magiclink:";

/**
 * 매직링크 토큰 발급. UUID를 키로 삼아 Redis에 payload(JSON)를 TTL과 함께 저장한다.
 * (issueNonce/consumeNonce와 달리 payload를 같이 들고 다녀야 해서 별도로 둔다 — API가
 * 링크를 소비할 때 "누구를 로그인시킬지"를 알아야 하기 때문.)
 *
 * @param {import("redis").RedisClientType} redis
 * @param {object} payload - 예: { discordId, tenantKey }
 * @param {number} ttlSec
 * @returns {Promise<string>} 발급된 토큰(UUID)
 */
export async function issueMagicLinkToken(redis, payload, ttlSec) {
    const token = randomUUID();
    const ttl = Math.max(1, Math.floor(Number(ttlSec) || 300));
    await redis.set(`${KEY_PREFIX}${token}`, JSON.stringify(payload ?? {}), {
        NX: true,
        EX: ttl,
    });
    return token;
}

/**
 * 매직링크 토큰 소비(1회용). 성공하면 payload를 반환하고 Redis에서 즉시 삭제한다.
 * 만료됐거나 이미 소비됐으면 null.
 *
 * @param {import("redis").RedisClientType} redis
 * @param {string} token
 * @returns {Promise<object | null>}
 */
export async function consumeMagicLinkToken(redis, token) {
    const key = `${KEY_PREFIX}${String(token ?? "").trim()}`;
    if (!key || key === KEY_PREFIX) return null;

    let raw;
    if (typeof redis.getDel === "function") {
        raw = await redis.getDel(key);
    } else {
        raw = await redis.get(key);
        if (raw != null) await redis.del(key);
    }
    if (raw == null) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}
