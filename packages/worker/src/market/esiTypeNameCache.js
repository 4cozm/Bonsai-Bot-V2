/**
 * ESI /universe/types/{type_id}로 타입 표시명 조회 + Redis 장기 캐시.
 * 캐시 키: typeName:ko:{typeId}, TTL 30일. 한글 요청 실패 시 영어 fallback.
 * 동시 ESI 호출 수 제한(429 방어).
 */
const ESI_BASE = "https://esi.evetech.net/latest";
const CACHE_KEY_PREFIX = "typeName:ko:";
const CACHE_TTL_SEC = 30 * 24 * 3600; // 30일
const ESI_CONCURRENCY = 5;

const queue = [];
let running = 0;

function runWithLimit(fn) {
    return new Promise((resolve, reject) => {
        const run = () => {
            running++;
            Promise.resolve(fn())
                .then(resolve, reject)
                .finally(() => {
                    running--;
                    if (queue.length > 0) queue.shift()();
                });
        };
        if (running < ESI_CONCURRENCY) run();
        else queue.push(run);
    });
}

/**
 * @param {import("redis").RedisClientType} redis
 * @param {number} typeId
 * @returns {Promise<string>} 표시명 (한글 우선, 실패 시 영어)
 */
export async function getTypeName(redis, typeId) {
    const key = `${CACHE_KEY_PREFIX}${typeId}`;
    const cached = await redis.get(key);
    if (typeof cached === "string" && cached.trim() !== "") return cached;

    const { name, skipCache } = await runWithLimit(() => fetchTypeName(typeId));
    const display = typeof name === "string" && name.trim() ? name.trim() : `타입 ${typeId}`;
    if (!skipCache) {
        await redis.set(key, display, { EX: CACHE_TTL_SEC });
    }
    return display;
}

/**
 * 여러 typeId의 표시명을 조회. 캐시된 것은 Redis에서, 나머지는 ESI로 조회 후 캐시.
 * @param {import("redis").RedisClientType} redis
 * @param {number[]} typeIds
 * @returns {Promise<Map<number, string>>} typeId -> name
 */
export async function getTypeNames(redis, typeIds) {
    const unique = [...new Set(typeIds)].filter((id) => Number.isInteger(id) && id > 0);
    const result = new Map();

    const cacheEntries = await Promise.all(
        unique.map(async (typeId) => {
            const key = `${CACHE_KEY_PREFIX}${typeId}`;
            const cached = await redis.get(key);
            return { typeId, cached };
        })
    );

    const uncached = [];
    for (const { typeId, cached } of cacheEntries) {
        const s = typeof cached === "string" ? cached.trim() : "";
        if (s !== "") {
            result.set(typeId, cached);
        } else {
            uncached.push(typeId);
        }
    }

    await Promise.all(
        uncached.map(async (typeId) => {
            const name = await getTypeName(redis, typeId);
            result.set(typeId, name);
        })
    );

    return result;
}

/**
 * ESI 호출: 한글 요청 후 실패 시 영어 fallback. 404 등 비성공 시 fallback 이름만 반환(캐시 안 함).
 * @param {number} typeId
 * @returns {Promise<{ name: string, skipCache: boolean }>}
 */
async function fetchTypeName(typeId) {
    const url = `${ESI_BASE}/universe/types/${typeId}/`;
    const withLang = (lang) =>
        fetch(`${url}?language=${lang}`, { headers: { Accept: "application/json" } });

    let res = await withLang("ko");
    if (!res.ok) {
        res = await withLang("en");
    }
    if (!res.ok) {
        return { name: `타입 ${typeId}`, skipCache: true };
    }
    const data = await res.json();
    const name = data?.name;
    if (typeof name !== "string" || !name.trim()) {
        return { name: `타입 ${typeId}`, skipCache: true };
    }
    return { name: name.trim(), skipCache: false };
}
