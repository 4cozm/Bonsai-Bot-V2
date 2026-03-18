// packages/worker/src/pajama/state.js
//
// Redis 상태 CRUD 헬퍼.
// 키 컨벤션: bonsai:{tenantKey}:pajama:{type}
//   - hot       : hot 유저 characterId[]
//   - target    : 타겟 유저 characterId[] (CA 임플 보유)
//   - structures: 모니터링 스트럭쳐 structureId[]
//   - online    : 현재 온라인 중인 타겟 유저 characterId[]
//   - docking   : 현재 스트럭쳐에 도킹 중인 타겟 유저 characterId[]
//
import { logger } from "@bonsai/shared";

const log = logger();

/**
 * @param {import("ioredis").Redis} redis
 * @param {string} tenantKey
 */
export function makePajamaState(redis, tenantKey) {
    const prefix = `bonsai:${tenantKey}:pajama`;
    const key = (type) => `${prefix}:${type}`;

    /**
     * 리스트 전체 조회. 없으면 빈 배열 반환.
     * @param {"hot"|"target"|"structures"|"online"|"docking"} type
     * @returns {Promise<string[]>}
     */
    const getList = async (type) => {
        try {
            const raw = await redis.get(key(type));
            return raw ? JSON.parse(raw) : [];
        } catch (err) {
            log.warn(`[pajama:state] getList 실패 type=${type}`, { message: err?.message });
            return [];
        }
    };

    /**
     * 리스트 전체 교체.
     * @param {"hot"|"target"|"structures"|"online"|"docking"} type
     * @param {(string|number|bigint)[]} arr
     */
    const setList = async (type, arr) => {
        try {
            await redis.set(key(type), JSON.stringify(arr.map(String)));
        } catch (err) {
            log.warn(`[pajama:state] setList 실패 type=${type}`, { message: err?.message });
        }
    };

    /**
     * 리스트에 id 추가 (중복 무시).
     * @param {"hot"|"target"|"structures"|"online"|"docking"} type
     * @param {string|number|bigint} id
     */
    const addToList = async (type, id) => {
        const list = await getList(type);
        const str = String(id);
        if (!list.includes(str)) {
            list.push(str);
            await setList(type, list);
        }
    };

    /**
     * 리스트에서 id 제거.
     * @param {"hot"|"target"|"structures"|"online"|"docking"} type
     * @param {string|number|bigint} id
     */
    const removeFromList = async (type, id) => {
        const list = await getList(type);
        const str = String(id);
        const filtered = list.filter((item) => item !== str);
        await setList(type, filtered);
    };

    /**
     * id가 리스트에 포함되어 있는지 확인.
     * @param {"hot"|"target"|"structures"|"online"|"docking"} type
     * @param {string|number|bigint} id
     * @returns {Promise<boolean>}
     */
    const isInList = async (type, id) => {
        const list = await getList(type);
        return list.includes(String(id));
    };

    return { getList, setList, addToList, removeFromList, isInList };
}
