/**
 * ESI 마켓 오더 조회 + Redis 캐시(TTL 3600) + per-key 락.
 * 리전 히스토리(평균가) 캐시 TTL 6h.
 * 캐시 키: mkt:{tenantKey}:esi:v1:{hub}:{typeId}
 * 히스토리: mkt:{tenantKey}:esi:history:v1:{regionId}:{typeId}
 * 동시성: ESI 호출 동시 4~6개로 제한(429 방어).
 */
import { HUBS } from "./constants.js";

const ESI_BASE = "https://esi.evetech.net/latest";
const CACHE_TTL_SEC = 3600;
const HISTORY_CACHE_TTL_SEC = 6 * 3600; // 6h
const LOCK_TTL_SEC = 30;
const LOCK_BACKOFF_MS = 500;
const LOCK_RETRIES = 6;

/** orders 페이지네이션: 최대 페이지 수(정확도-비용 트레이드오프) */
const PAGE_CAP = 10;
/** 스테이션 오더 1건이라도 발견 후 추가로 볼 페이지 수(조기 종료) */
const EXTRA_PAGES_AFTER_HIT = 2;
/** 동시 ESI 요청 수 제한(429 방어) */
const ESI_CONCURRENCY = 5;

/** 동시 실행 수 제한용 큐 */
const esiQueue = [];
let esiRunning = 0;

function runWithLimit(fn) {
    return new Promise((resolve, reject) => {
        const run = () => {
            esiRunning++;
            Promise.resolve(fn())
                .then(resolve, reject)
                .finally(() => {
                    esiRunning--;
                    if (esiQueue.length > 0) esiQueue.shift()();
                });
        };
        if (esiRunning < ESI_CONCURRENCY) run();
        else esiQueue.push(run);
    });
}

/**
 * @param {import("redis").RedisClientType} redis
 * @param {{ tenantKey: string, hub: "jita"|"amarr", typeId: number }} opts
 * @returns {Promise<{ fetchedAt: number, sellMin: number|null, buyMax: number|null, regionId: number, stationId: number, typeId: number, stale?: boolean, capped?: boolean }>}
 */
export async function getMarketPrice(redis, { tenantKey, hub, typeId }) {
    const tenant = String(tenantKey ?? "").trim();
    const hubKey = hub === "amarr" ? "amarr" : "jita";
    const hubInfo = HUBS[hubKey];
    const cacheKey = `mkt:${tenant}:esi:v1:${hubKey}:${typeId}`;
    const lockKey = `mkt:${tenant}:esi:lock:${hubKey}:${typeId}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
        try {
            const data = JSON.parse(cached);
            return {
                fetchedAt: data.fetchedAt,
                sellMin: data.sellMin ?? null,
                buyMax: data.buyMax ?? null,
                regionId: hubInfo.regionId,
                stationId: hubInfo.stationId,
                typeId: data.typeId ?? typeId,
                ...(data.capped && { capped: true }),
            };
        } catch {
            // invalid JSON, fall through to fetch
        }
    }

    let lockAcquired = false;
    for (let i = 0; i < LOCK_RETRIES; i++) {
        const ok = await redis.set(lockKey, "1", { NX: true, EX: LOCK_TTL_SEC });
        if (ok) {
            lockAcquired = true;
            break;
        }
        await sleep(LOCK_BACKOFF_MS * (i + 1));
        const recheck = await redis.get(cacheKey);
        if (recheck) {
            const data = JSON.parse(recheck);
            return {
                fetchedAt: data.fetchedAt,
                sellMin: data.sellMin ?? null,
                buyMax: data.buyMax ?? null,
                regionId: hubInfo.regionId,
                stationId: hubInfo.stationId,
                typeId: data.typeId ?? typeId,
                ...(data.capped && { capped: true }),
            };
        }
    }

    if (!lockAcquired) {
        const stale = await redis.get(cacheKey);
        if (stale) {
            const data = JSON.parse(stale);
            return {
                fetchedAt: data.fetchedAt,
                sellMin: data.sellMin ?? null,
                buyMax: data.buyMax ?? null,
                regionId: hubInfo.regionId,
                stationId: hubInfo.stationId,
                typeId: data.typeId ?? typeId,
                stale: true,
                ...(data.capped && { capped: true }),
            };
        }
        throw new Error("시세 조회가 지연 중입니다. 잠시 후 다시 시도해 주세요.");
    }

    try {
        const { sellMin, buyMax, capped } = await runWithLimit(() =>
            fetchStationOrders(hubInfo.regionId, hubInfo.stationId, typeId)
        );
        const value = {
            fetchedAt: Math.floor(Date.now() / 1000),
            sellMin,
            buyMax,
            regionId: hubInfo.regionId,
            stationId: hubInfo.stationId,
            typeId,
            ...(capped && { capped: true }),
        };
        await redis.set(cacheKey, JSON.stringify(value), { EX: CACHE_TTL_SEC });
        return value;
    } finally {
        await redis.del(lockKey).catch(() => {});
    }
}

/**
 * 리전 히스토리 기반 평균가(최근 1일/7일). 캐시 TTL 6h.
 * @param {import("redis").RedisClientType} redis
 * @param {{ tenantKey: string, regionId: number, typeId: number }} opts
 * @returns {Promise<{ regionAvg1d: number|null, regionAvg7d: number|null, stale?: boolean }>}
 */
export async function getRegionHistory(redis, { tenantKey, regionId, typeId }) {
    const tenant = String(tenantKey ?? "").trim();
    const cacheKey = `mkt:${tenant}:esi:history:v1:${regionId}:${typeId}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
        try {
            const data = JSON.parse(cached);
            return {
                regionAvg1d: data.regionAvg1d ?? null,
                regionAvg7d: data.regionAvg7d ?? null,
            };
        } catch {
            // fall through
        }
    }

    const fetchHistory = async () => {
        const res = await fetch(`${ESI_BASE}/markets/${regionId}/history/?type_id=${typeId}`);
        if (!res.ok) throw new Error(`ESI history 실패: ${res.status}`);
        const list = await res.json();
        if (!Array.isArray(list) || list.length === 0) {
            return { regionAvg1d: null, regionAvg7d: null };
        }
        // ESI: date 오름차순 → 마지막이 최신
        const last7 = list.slice(-7);
        const last1 = list.slice(-1);
        const sum7 = last7.reduce((s, e) => s + (Number(e.average) || 0), 0);
        const avg7 = last7.length ? sum7 / last7.length : null;
        const avg1 = last1.length ? Number(last1[0].average) || null : null;
        return { regionAvg1d: avg1, regionAvg7d: avg7 };
    };

    try {
        const { regionAvg1d, regionAvg7d } = await runWithLimit(fetchHistory);
        const value = { regionAvg1d, regionAvg7d };
        await redis.set(cacheKey, JSON.stringify(value), {
            EX: HISTORY_CACHE_TTL_SEC,
        });
        return value;
    } catch (err) {
        const stale = await redis.get(cacheKey);
        if (stale) {
            const data = JSON.parse(stale);
            return {
                regionAvg1d: data.regionAvg1d ?? null,
                regionAvg7d: data.regionAvg7d ?? null,
                stale: true,
            };
        }
        throw err;
    }
}

/**
 * 스테이션 한정 best sell/buy. pageCap=10, 스테이션 오더 발견 후 extraPagesAfterHit만 추가 페이지 후 종료.
 * @param {number} regionId
 * @param {number} stationId
 * @param {number} typeId
 * @returns {Promise<{ sellMin: number|null, buyMax: number|null, capped?: boolean }>}
 */
async function fetchStationOrders(regionId, stationId, typeId) {
    let sellMin = null;
    let buyMax = null;
    let sellPage = 1;
    let buyPage = 1;
    let sellHitPage = null;
    let buyHitPage = null;
    let sellDone = false;
    let buyDone = false;

    const shouldFetchSell = () =>
        !sellDone &&
        sellPage <= PAGE_CAP &&
        (sellHitPage == null || sellPage <= sellHitPage + EXTRA_PAGES_AFTER_HIT);
    const shouldFetchBuy = () =>
        !buyDone &&
        buyPage <= PAGE_CAP &&
        (buyHitPage == null || buyPage <= buyHitPage + EXTRA_PAGES_AFTER_HIT);

    while (shouldFetchSell() || shouldFetchBuy()) {
        const [sellRes, buyRes] = await Promise.all([
            shouldFetchSell()
                ? fetch(
                      `${ESI_BASE}/markets/${regionId}/orders/?order_type=sell&type_id=${typeId}&page=${sellPage}`
                  )
                : null,
            shouldFetchBuy()
                ? fetch(
                      `${ESI_BASE}/markets/${regionId}/orders/?order_type=buy&type_id=${typeId}&page=${buyPage}`
                  )
                : null,
        ]);

        if (sellRes) {
            if (!sellRes.ok) throw new Error(`ESI 마켓(sell) 실패: ${sellRes.status}`);
            const sellOrders = await sellRes.json();
            for (const o of sellOrders) {
                if (o.location_id === stationId && typeof o.price === "number") {
                    if (sellMin == null || o.price < sellMin) sellMin = o.price;
                    if (sellHitPage == null) sellHitPage = sellPage;
                }
            }
            sellPage++;
            if (sellHitPage != null && sellPage > sellHitPage + EXTRA_PAGES_AFTER_HIT)
                sellDone = true;
            if (sellPage > PAGE_CAP) sellDone = true;
        }

        if (buyRes) {
            if (!buyRes.ok) throw new Error(`ESI 마켓(buy) 실패: ${buyRes.status}`);
            const buyOrders = await buyRes.json();
            for (const o of buyOrders) {
                if (o.location_id === stationId && typeof o.price === "number") {
                    if (buyMax == null || o.price > buyMax) buyMax = o.price;
                    if (buyHitPage == null) buyHitPage = buyPage;
                }
            }
            buyPage++;
            if (buyHitPage != null && buyPage > buyHitPage + EXTRA_PAGES_AFTER_HIT) buyDone = true;
            if (buyPage > PAGE_CAP) buyDone = true;
        }
    }

    const capped =
        (sellPage > PAGE_CAP && sellMin == null) || (buyPage > PAGE_CAP && buyMax == null);
    return { sellMin, buyMax, ...(capped && { capped: true }) };
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
