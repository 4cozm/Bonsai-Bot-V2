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
        for (const r of rows) delete r.hasStale;

        rows.sort((a, b) => (b.iskPerM3 ?? 0) - (a.iskPerM3 ?? 0));

        const lines = rows.map((r) => {
            if (r.error) return `**${r.name}** — ${r.error}`;
            const jCap = r.jitaCapped ? " (cap)" : "";
            const aCap = r.amarrCapped ? " (cap)" : "";
            const j = `Jita ${fmtIsk(r.jitaSell)}/${fmtIsk(r.jitaBuy)}${jCap}`;
            const a = `Amarr ${fmtIsk(r.amarrSell)}/${fmtIsk(r.amarrBuy)}${aCap}`;
            const d = r.delta != null ? ` Δ ${fmtIsk(r.delta)} (${fmtPct(r.deltaPct)})` : "";
            const m3 = r.iskPerM3 != null ? ` · ${fmtIsk(r.iskPerM3)} ISK/m³` : "";
            const regionAvg =
                r.regionAvg1dJita != null || r.regionAvg1dAmarr != null
                    ? ` · Region Avg(1d): Jita ${fmtIsk(r.regionAvg1dJita)} / Amarr ${fmtIsk(r.regionAvg1dAmarr)}`
                    : "";
            return `**${r.name}** ${j} · ${a}${d}${m3}${regionAvg}`;
        });

        const value = lines.join("\n");
        const footer = hasStale ? "일부 데이터는 캐시(stale)입니다." : "ESI 기준, 1시간 캐시";

        log.info(`[cmd:가스시세] tenant=${tenantKey} items=${rows.length} stale=${hasStale}`);

        return {
            ok: true,
            data: {
                embed: true,
                title: "웜홀 가스 시세 (Fullerite)",
                description:
                    "Jita/Amarr 스테이션 기준 · sell/buy · Δ(Amarr−Jita) · ISK/m³ (내림차순)",
                fields: [{ name: "시세", value: value || "조회 실패", inline: false }],
                footer,
            },
        };
    },
};
