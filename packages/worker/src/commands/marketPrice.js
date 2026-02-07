// packages/worker/src/commands/marketPrice.js
import { logger } from "@bonsai/shared";
import {
    FULLERITE_ITEMS,
    HUB_CHOICES,
    HUBS,
    ICE_ITEMS,
    MINERAL_ITEMS,
} from "../market/constants.js";
import {
    formatMarketEmbedFields,
    formatTimestampKST,
    shortenItemName,
} from "../market/embedFormat.js";
import { getMarketPrice } from "../market/esiMarketCache.js";

const log = logger();

const TOP_N = 12;

const TYPE_CHOICES = Object.freeze([
    { name: "광물", value: "mineral" },
    { name: "아이스", value: "ice" },
    { name: "가스", value: "gas" },
]);

const TYPE_CONFIG = Object.freeze({
    mineral: {
        items: MINERAL_ITEMS,
        titlePrefix: "압축 광물",
        shortenCategory: "mineral",
        color: 0x2ecc71,
    },
    ice: {
        items: ICE_ITEMS,
        titlePrefix: "아이스 산출물",
        shortenCategory: "ice",
        color: 0x1abc9c,
    },
    gas: {
        items: FULLERITE_ITEMS,
        titlePrefix: "웜홀 가스",
        shortenCategory: "fullerite",
        color: 0x3498db,
    },
});

export default {
    name: "시세",
    discord: {
        name: "시세",
        description: "광물·아이스·가스 시세 — 상권 선택",
        type: 1,
        options: [
            {
                name: "type",
                description: "시세 종류",
                type: 3,
                required: true,
                choices: [...TYPE_CHOICES],
            },
            {
                name: "hub",
                description: "상권 (지타/아마르/헤크/도딕시/렌스 중 선택)",
                type: 3,
                required: true,
                choices: [...HUB_CHOICES],
            },
            {
                name: "ephemeral",
                description: "본인만 보기 (기본: 켜짐)",
                type: 5,
                required: false,
            },
        ],
    },

    /**
     * @param {object} ctx
     * @param {import("redis").RedisClientType} ctx.redis
     * @param {string} ctx.tenantKey
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const redis = ctx?.redis;
        const tenantKey = String(ctx?.tenantKey ?? "").trim();
        if (!redis || !tenantKey) {
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }

        let args = {};
        try {
            const raw = envelope?.args;
            if (typeof raw === "string" && raw.trim()) args = JSON.parse(raw);
            else if (raw && typeof raw === "object") args = raw;
        } catch {
            // ignore
        }

        const typeRaw = String(args?.type ?? "")
            .trim()
            .toLowerCase();
        if (!TYPE_CONFIG[typeRaw]) {
            return {
                ok: false,
                data: {
                    error: "시세 종류를 선택해 주세요. 광물 / 아이스 / 가스 중 하나입니다.",
                },
            };
        }

        const hub = String(args?.hub ?? "")
            .trim()
            .toLowerCase();
        if (!hub || !HUBS[hub]) {
            return {
                ok: false,
                data: {
                    error: "지원하지 않는 상권입니다. 지타/아마르/헤크/도딕시/렌스 중 선택해 주세요.",
                },
            };
        }

        const ephemeral = args?.ephemeral !== false;

        const config = TYPE_CONFIG[typeRaw];
        const items = config.items;
        const hubInfo = HUBS[hub];

        log.info("[cmd:시세] 시세 조회 시작", {
            tenant: tenantKey,
            type: typeRaw,
            hub,
            items: items.length,
        });

        const rowPromises = items.map(async (item) => {
            try {
                const price = await getMarketPrice(redis, {
                    tenantKey,
                    hub,
                    typeId: item.typeId,
                });
                const sell = price.sellMin;
                const buy = price.buyMax;

                if ((sell != null && sell <= 0) || (item.volume != null && item.volume <= 0)) {
                    log.warn("[cmd:시세] 데이터 이상", {
                        type: typeRaw,
                        typeId: item.typeId,
                        sell,
                        volume: item.volume,
                    });
                }

                const spreadPct =
                    sell != null && buy != null && sell > 0 ? ((sell - buy) / sell) * 100 : null;
                const iskPerM3 = sell != null && item.volume > 0 ? sell / item.volume : null;

                return {
                    name: item.name,
                    typeId: item.typeId,
                    volume: item.volume,
                    sell,
                    buy,
                    spreadPct,
                    iskPerM3,
                    fetchedAt: price.fetchedAt,
                    hasStale: price.stale ?? false,
                };
            } catch (err) {
                log.warn(`[cmd:시세] type=${typeRaw} typeId=${item.typeId} err=${err?.message}`);
                return {
                    name: item.name,
                    typeId: item.typeId,
                    volume: item.volume,
                    sell: null,
                    buy: null,
                    spreadPct: null,
                    iskPerM3: null,
                    fetchedAt: null,
                    hasStale: false,
                    error: err?.message,
                };
            }
        });

        const rows = await Promise.all(rowPromises);
        const hasStale = rows.some((r) => r.hasStale);
        const errorCount = rows.filter((r) => r.error).length;
        const hasAnyPrice = rows.some((r) => r.sell != null || r.buy != null);
        const noData = rows.length === 0 || errorCount === rows.length || !hasAnyPrice;

        log.info("[cmd:시세] 시세 수집 완료", {
            tenant: tenantKey,
            type: typeRaw,
            hub,
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
            return {
                ok: false,
                data: { error: msg, ephemeralReply: ephemeral },
            };
        }

        rows.sort((a, b) => (b.iskPerM3 ?? 0) - (a.iskPerM3 ?? 0));
        const top = rows.slice(0, TOP_N);

        const fetchedAtMax = Math.max(...top.map((r) => r.fetchedAt ?? 0), 0);
        const timestampKST =
            fetchedAtMax > 0
                ? formatTimestampKST(fetchedAtMax)
                : formatTimestampKST(Math.floor(Date.now() / 1000));

        const tableRows = top.map((r) => ({
            item: shortenItemName(r.name ?? `타입 ${r.typeId}`, config.shortenCategory),
            sell: r.sell ?? null,
            buy: r.buy ?? null,
            sprd: r.spreadPct ?? null,
            iskm3:
                r.iskPerM3 != null && Number.isFinite(r.iskPerM3) ? Math.round(r.iskPerM3) : null,
        }));

        const title = `${config.titlePrefix} · ${hubInfo.label}`;
        const description =
            `${hubInfo.stationName}\n` + `정렬 ISK/m³@Sell ↓ · Top ${TOP_N} · 갱신 ${timestampKST}`;
        const footer = hasStale
            ? "일부 캐시(stale) · ESI 기준 · 60초 캐시"
            : "ESI 기준 · 60초 캐시";

        const { itemValue, sellBuyValue, iskm3Value } = formatMarketEmbedFields(tableRows);

        const embeds = [
            {
                title,
                description,
                fields: [
                    { name: "Item", value: itemValue, inline: true },
                    { name: "Sell / Buy", value: sellBuyValue, inline: true },
                    { name: "ISK·m³", value: iskm3Value, inline: true },
                ],
                footer,
                color: config.color,
                timestamp: false,
            },
        ];

        return {
            ok: true,
            data: {
                embed: true,
                embeds,
                title,
                description,
                footer,
                ephemeralReply: ephemeral,
            },
        };
    },
};
