// packages/worker/src/pajama/state.js
//
// Redis 상태 CRUD 헬퍼 (Redis Set 자료형).
// 키 컨벤션: bonsai:{tenantKey}:pajama:{type}
//   - hot       : hot 유저 characterId 집합
//   - target    : 타겟 유저 characterId 집합 (CA 임플 보유)
//   - structures: 모니터링 스트럭쳐 structureId 집합
//   - online    : 현재 온라인 중인 타겟 유저 characterId 집합
//   - docking   : 현재 스트럭쳐에 도킹 중인 타겟 유저 characterId 집합
//
// 여러 폴러가 같은 키를 동시에 갱신하므로, JSON 배열을 통째로 GET/SET 하면
// read-modify-write 경쟁으로 lost update가 발생한다. Set 자료형 + 원자 연산
// (SADD/SREM)으로 멤버십을 갱신해 경쟁을 구조적으로 제거한다.
//
import { logger } from "@bonsai/shared";

const log = logger();

/** node-redis가 키 타입 불일치(구버전 JSON 문자열 잔존)로 던지는 에러인지. */
function isWrongType(err) {
    return String(err?.message ?? "").includes("WRONGTYPE");
}

/** id 배열을 문자열로 정규화하고 빈 값 제거. */
function normalizeIds(ids) {
    return (ids ?? []).map(String).filter(Boolean);
}

/**
 * @param {import("redis").RedisClientType} redis
 * @param {string} tenantKey
 */
export function makePajamaState(redis, tenantKey) {
    const prefix = `bonsai:${tenantKey}:pajama`;
    const key = (type) => `${prefix}:${type}`;

    /**
     * 집합 전체 조회. 없거나 실패하면 빈 배열.
     * @param {"hot"|"target"|"structures"|"online"|"docking"} type
     * @returns {Promise<string[]>}
     */
    const getMembers = async (type) => {
        try {
            return await redis.sMembers(key(type));
        } catch (err) {
            // 구버전 문자열 키가 남아 있으면 WRONGTYPE → 빈 집합으로 간주(아래 쓰기에서 마이그레이션됨)
            if (isWrongType(err)) return [];
            log.warn(`[pajama:state] getMembers 실패 type=${type}`, { message: err?.message });
            return [];
        }
    };

    /**
     * 집합에 멤버 추가 (원자적 SADD).
     * @param {"online"|"docking"|"hot"|"target"|"structures"} type
     * @param {(string|number|bigint)[]} ids
     */
    const addMembers = async (type, ids) => {
        const members = normalizeIds(ids);
        if (members.length === 0) return;
        const k = key(type);
        try {
            await redis.sAdd(k, members);
        } catch (err) {
            if (isWrongType(err)) {
                // 구버전 JSON 문자열 키 → 삭제 후 Set으로 재생성
                try {
                    await redis.del(k);
                    await redis.sAdd(k, members);
                    return;
                } catch (e2) {
                    log.warn(`[pajama:state] addMembers 마이그레이션 실패 type=${type}`, {
                        message: e2?.message,
                    });
                    return;
                }
            }
            log.warn(`[pajama:state] addMembers 실패 type=${type}`, { message: err?.message });
        }
    };

    /**
     * 집합에서 멤버 제거 (원자적 SREM).
     * @param {"online"|"docking"|"hot"|"target"|"structures"} type
     * @param {(string|number|bigint)[]} ids
     */
    const removeMembers = async (type, ids) => {
        const members = normalizeIds(ids);
        if (members.length === 0) return;
        try {
            await redis.sRem(key(type), members);
        } catch (err) {
            // WRONGTYPE면 제거할 Set 자체가 없는 것 → 무시
            if (isWrongType(err)) return;
            log.warn(`[pajama:state] removeMembers 실패 type=${type}`, { message: err?.message });
        }
    };

    /**
     * 집합 전체 교체 (DEL + SADD 원자 실행). 주기적으로 전량 재계산하는 키용(hot/target/structures).
     * @param {"hot"|"target"|"structures"} type
     * @param {(string|number|bigint)[]} ids
     */
    const replaceMembers = async (type, ids) => {
        const members = normalizeIds(ids);
        const k = key(type);
        try {
            if (members.length === 0) {
                await redis.del(k);
                return;
            }
            await redis.multi().del(k).sAdd(k, members).exec();
        } catch (err) {
            log.warn(`[pajama:state] replaceMembers 실패 type=${type}`, { message: err?.message });
        }
    };

    return { getMembers, addMembers, removeMembers, replaceMembers };
}
