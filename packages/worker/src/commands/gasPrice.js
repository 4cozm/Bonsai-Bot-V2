// packages/worker/src/commands/gasPrice.js
import { logger } from "@bonsai/shared";
import { FULLERITE_ITEMS, HUBS } from "../market/constants.js";
import { getMarketPrice, getRegionHistory } from "../market/esiMarketCache.js";

const log = logger();

function fmtIsk(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return Math.round(n).toLocaleString();
}

function fmtPct(p) {
    if (p == null || !Number.isFinite(p)) return "—";
    return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export default {
    name: "가스시세",
    discord: {
        name: "가스시세",
        description: "웜홀 가스(Fullerite 9종) 시세 (Jita/Amarr)",
        type: 1,
        options: [],
    },

    /**
     * @param {object} ctx
     * @param {import("redis").RedisClientType} ctx.redis
     * @param {string} ctx.tenantKey
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, _envelope) {
        const redis = ctx?.redis;
        const tenantKey = String(ctx?.tenantKey ?? "").trim();
        if (!redis || !tenantKey) {
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }

        const itemCount = FULLERITE_ITEMS.length;
        log.info("[cmd:가스시세] 시세 조회 시작", { tenant: tenantKey, items: itemCount });

        const rowPromises = FULLERITE_ITEMS.map(async (item) => {
            try {
                const [jita, amarr, histJita, histAmarr] = await Promise.all([
                    getMarketPrice(redis, { tenantKey, hub: "jita", typeId: item.typeId }),
                    getMarketPrice(redis, { tenantKey, hub: "amarr", typeId: item.typeId }),
                    getRegionHistory(redis, {
                        tenantKey,
                        regionId: HUBS.jita.regionId,
                        typeId: item.typeId,
                    }).catch(() => ({ regionAvg1d: null, regionAvg7d: null })),
                    getRegionHistory(redis, {
                        tenantKey,
                        regionId: HUBS.amarr.regionId,
                        typeId: item.typeId,
                    }).catch(() => ({ regionAvg1d: null, regionAvg7d: null })),
                ]);
                const jitaSell = jita.sellMin;
                const amarrSell = amarr.sellMin;
                const delta = jitaSell != null && amarrSell != null ? amarrSell - jitaSell : null;
                const deltaPct =
                    jitaSell != null && jitaSell !== 0 && delta != null
                        ? (delta / jitaSell) * 100
                        : null;
                const iskPerM3 =
                    jitaSell != null && item.volume > 0 ? jitaSell / item.volume : null;
                return {
                    name: item.name,
                    typeId: item.typeId,
                    volume: item.volume,
                    jitaSell,
                    jitaBuy: jita.buyMax,
                    amarrSell,
                    amarrBuy: amarr.buyMax,
                    jitaCapped: jita.capped ?? false,
                    amarrCapped: amarr.capped ?? false,
                    delta,
                    deltaPct,
                    iskPerM3,
                    regionAvg1dJita: histJita?.regionAvg1d ?? null,
                    regionAvg1dAmarr: histAmarr?.regionAvg1d ?? null,
                    hasStale: jita.stale || amarr.stale,
                };
            } catch (err) {
                log.warn(`[cmd:가스시세] typeId=${item.typeId} err=${err?.message}`);
                return {
                    name: item.name,
                    typeId: item.typeId,
                    volume: item.volume,
                    jitaSell: null,
                    jitaBuy: null,
                    amarrSell: null,
                    amarrBuy: null,
                    jitaCapped: false,
                    amarrCapped: false,
                    delta: null,
                    deltaPct: null,
                    iskPerM3: null,
                    regionAvg1dJita: null,
                    regionAvg1dAmarr: null,
                    error: err?.message,
                    hasStale: false,
                };
            }
        });
        const rows = await Promise.all(rowPromises);
        const hasStale = rows.some((r) => r.hasStale);
        const errorCount = rows.filter((r) => r.error).length;
        for (const r of rows) delete r.hasStale;

        const hasAnyPrice = rows.some((r) => r.jitaSell != null || r.amarrSell != null);
        const noData = rows.length === 0 || errorCount === rows.length || !hasAnyPrice;

        log.info("[cmd:가스시세] 시세 수집 완료", {
            tenant: tenantKey,
            rows: rows.length,
            errors: errorCount,
            stale: hasStale,
            noData,
        });

        if (noData) {
            const msg =
                errorCount === rows.length && rows.length > 0
                    ? `시세 조회 실패 (모든 품목 오류, ${errorCount}건). ESI/네트워크 확인 후 재시도해 주세요.`
                    : "시세 데이터를 가져오지 못했습니다.";
            log.warn("[cmd:가스시세] 반환: 오류 (데이터 없음)", {
                tenant: tenantKey,
                errorCount,
                rows: rows.length,
            });
            return {
                ok: false,
                data: { error: msg },
            };
        }

        rows.sort((a, b) => (b.iskPerM3 ?? 0) - (a.iskPerM3 ?? 0));

        const ITEMS_PER_PAGE = 10;
        const footer = hasStale ? "일부 데이터는 캐시(stale)입니다." : "ESI 기준, 1시간 캐시";
        const baseTitle = "웜홀 가스 시세 (Fullerite)";
        const baseDescription = "Jita/Amarr 스테이션 S/B · Δ(Amarr−Jita)% · ISK/m³ (내림차순)";

        const embeds = [];
        for (let p = 0; p < rows.length; p += ITEMS_PER_PAGE) {
            const chunk = rows.slice(p, p + ITEMS_PER_PAGE);
            const names = chunk.map((r) => {
                const label = r.name != null && String(r.name).trim() ? r.name : `타입 ${r.typeId}`;
                return r.error ? `${label} — 오류` : label;
            });
            const jitaAmarr = chunk.map((r) => {
                if (r.error) return "—";
                const j = `${fmtIsk(r.jitaSell)}/${fmtIsk(r.jitaBuy)}${r.jitaCapped ? " (cap)" : ""}`;
                const a = `${fmtIsk(r.amarrSell)}/${fmtIsk(r.amarrBuy)}${r.amarrCapped ? " (cap)" : ""}`;
                return `${j} ${a}`;
            });
            const deltaM3 = chunk.map((r) => {
                if (r.error) return "—";
                const d = r.deltaPct != null ? fmtPct(r.deltaPct) : "—";
                const m3 = r.iskPerM3 != null ? fmtIsk(r.iskPerM3) : "—";
                return `${d} · ${m3}`;
            });
            const pageNum = Math.floor(p / ITEMS_PER_PAGE) + 1;
            const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE);
            const title = totalPages > 1 ? `${baseTitle} (${pageNum}/${totalPages})` : baseTitle;
            embeds.push({
                title,
                description: p === 0 ? baseDescription : undefined,
                fields: [
                    { name: "품목", value: names.join("\n") || "—", inline: true },
                    { name: "Jita/Amarr (S/B)", value: jitaAmarr.join("\n") || "—", inline: true },
                    { name: "Δ% · ISK/m³", value: deltaM3.join("\n") || "—", inline: true },
                ],
                footer,
            });
        }

        log.info("[cmd:가스시세] 응답 반환 완료", {
            tenant: tenantKey,
            embedPages: embeds.length,
            stale: hasStale,
        });

        return {
            ok: true,
            data: {
                embed: true,
                embeds: embeds.length ? embeds : undefined,
                title: baseTitle,
                description: baseDescription,
                fields:
                    embeds.length === 0
                        ? [{ name: "시세", value: "조회 실패", inline: false }]
                        : undefined,
                footer,
            },
        };
    },
};
