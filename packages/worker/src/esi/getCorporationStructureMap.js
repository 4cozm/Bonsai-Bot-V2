// packages/worker/src/esi/getCorporationStructureMap.js
// 코퍼레이션 구조물 목록을 structure_id → { name, system_id, type_id } 맵으로 반환.
// /corporations/{id}/structures/ 응답에 name이 포함되므로
// esi-corporations.read_structures.v1 스코프만으로 건물 이름을 얻을 수 있다.
// (esi-universe.read_structures.v1 / 도킹 권한 불필요.)

import { getAccessTokenForCharacter, logger } from "@bonsai/shared";
import { getCorporationStructures } from "./getCorporationStructures.js";

const log = logger();
const CACHE_KEY_PREFIX = "bonsai:cache:esi:corp_structures_map:";
const CACHE_TTL_SEC = 60 * 60; // 1시간 (건물 추가/파괴 반영 주기)

/**
 * @param {object} params
 * @param {import("redis").RedisClientType | null | undefined} params.redis
 * @param {import("@prisma/client").PrismaClient} params.prisma
 * @param {number} params.corporationId
 * @param {bigint} params.characterId
 * @param {{ warn: Function }} [params.log]
 * @returns {Promise<Record<string, { name: string | null, system_id: number | null, type_id: number | null }>>}
 */
export async function getCorporationStructureMap({
    redis,
    prisma,
    corporationId,
    characterId,
    log: logArg,
}) {
    const lg = logArg ?? log;
    const cacheKey = `${CACHE_KEY_PREFIX}${corporationId}`;

    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch {
            // 캐시 파싱 실패 시 직접 조회
        }
    }

    const accessToken = await getAccessTokenForCharacter(prisma, characterId);
    if (!accessToken) {
        lg.warn("[esi:corpStructMap] 토큰 없음", {
            corporationId,
            characterId: String(characterId),
        });
        return {};
    }

    const list = await getCorporationStructures(accessToken, corporationId);
    if (!Array.isArray(list)) return {};

    /** @type {Record<string, { name: string | null, system_id: number | null, type_id: number | null }>} */
    const map = {};
    for (const s of list) {
        if (s?.structure_id == null) continue;
        map[String(s.structure_id)] = {
            name: s.name ?? null,
            system_id: s.system_id ?? null,
            type_id: s.type_id ?? null,
        };
    }

    if (redis) {
        try {
            await redis.set(cacheKey, JSON.stringify(map), { EX: CACHE_TTL_SEC });
        } catch {
            // 캐시 저장 실패는 무시
        }
    }

    return map;
}
