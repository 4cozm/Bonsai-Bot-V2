// packages/worker/src/esi/getSolarSystemName.js
// ESI 공개 엔드포인트로 성계 ID → 성계 이름 조회. 성계 이름은 사실상 불변이라 Redis에 장기 캐싱.

import { logger } from "@bonsai/shared";

const log = logger();
const ESI_SYSTEMS_URL = "https://esi.evetech.net/latest/universe/systems";
const CACHE_KEY_PREFIX = "bonsai:cache:esi:system_name:";
const CACHE_TTL_SEC = 60 * 60 * 24 * 30; // 30일

/**
 * 성계 ID로 성계 이름 조회. 인증 불필요(공개 엔드포인트).
 * @param {import("redis").RedisClientType | null | undefined} redis
 * @param {number | string} systemId
 * @returns {Promise<string | null>} 성계 이름 또는 실패 시 null
 */
export async function getSolarSystemName(redis, systemId) {
    const id = Number(systemId);
    if (!Number.isInteger(id) || id <= 0) return null;

    const cacheKey = `${CACHE_KEY_PREFIX}${id}`;
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return cached;
        } catch {
            // 캐시 실패 시 직접 조회
        }
    }

    try {
        const res = await fetch(`${ESI_SYSTEMS_URL}/${id}/`, { method: "GET" });
        if (!res.ok) return null;
        const data = await res.json();
        const name = data?.name ?? null;
        if (name && redis) {
            try {
                await redis.set(cacheKey, name, { EX: CACHE_TTL_SEC });
            } catch {
                // 캐시 저장 실패는 무시
            }
        }
        return name;
    } catch (err) {
        log.warn("[esi:systemName] 성계 이름 조회 실패", {
            systemId: id,
            message: err?.message ?? String(err),
        });
        return null;
    }
}
