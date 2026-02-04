// packages/shared/src/esi/redisNonce.js
/**
 * stateNonce 1회성 소비: 발급 시 Redis SET key NX EX, 콜백에서 GETDEL/DEL로 소비.
 * 리플레이 방지용.
 *
 * @param {import("redis").RedisClientType} redis
 * @param {string} key nonce 키 (예: bonsai:esi:nonce:{stateNonce})
 * @param {number} ttlSec TTL(초)
 * @returns {Promise<boolean>} true면 발급 성공(이미 있으면 false)
 */
export async function issueNonce(redis, key, ttlSec) {
    const k = String(key ?? "").trim();
    if (!k) throw new Error("nonce key가 비어있습니다.");
    const ttl = Math.max(1, Math.floor(Number(ttlSec) || 600));
    // SET key "1" NX EX ttl → 새로 넣은 경우만 true
    const result = await redis.set(k, "1", { NX: true, EX: ttl });
    return result === "OK";
}

/**
 * nonce 소비: GETDEL(Redis 6.2+) 또는 GET 후 DEL.
 * 한 번만 소비 가능. 이미 소비되었으면 false.
 *
 * @param {import("redis").RedisClientType} redis
 * @param {string} key
 * @returns {Promise<boolean>} true면 이번 호출에서 소비 성공
 */
export async function consumeNonce(redis, key) {
    const k = String(key ?? "").trim();
    if (!k) throw new Error("nonce key가 비어있습니다.");
    if (typeof redis.getDel === "function") {
        const val = await redis.getDel(k);
        if (val != null) return true;
        return false;
    }
    // fallback: get then del (small race window; acceptable for nonce)
    const v = await redis.get(k);
    if (v == null) return false;
    await redis.del(k);
    return true;
}
