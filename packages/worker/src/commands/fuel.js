// packages/worker/src/commands/fuel.js
import { getAccessTokenForCharacter, parseAnchorCharIds, logger } from "@bonsai/shared";
import { getCorporationStructures } from "../esi/getCorporationStructures.js";
import { structureTypeMapping } from "../esi/structureTypeMapping.js";

const log = logger();

const FUEL_CACHE_TTL_SEC = 60;
const FUEL_CACHE_KEY_PREFIX = "bonsai:cache:fuel:";

/**
 * /연료: 테넌트별 EVE_ANCHOR_CHARIDS로 코퍼레이션 구조물 연료 조회 후 임베드 반환.
 * 성공 응답은 1분간 Redis 캐시(난사 방지). 자동 연료 체크는 fuelDailyCheck.
 */
export default {
    name: "연료",
    discord: {
        name: "연료",
        description: "스트럭쳐의 현재 연료량을 반환합니다",
        type: 1,
        options: [
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
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {string} ctx.tenantKey
     * @param {any} envelope
     * @returns {Promise<{ok: boolean, data: any}>}
     */
    async execute(ctx, envelope) {
        const prisma = ctx?.prisma;
        const redis = ctx?.redis;
        const tenantKey = String(ctx?.tenantKey ?? "").trim();

        let args = {};
        try {
            const raw = envelope?.args;
            if (typeof raw === "string" && raw.trim()) args = JSON.parse(raw);
            else if (raw && typeof raw === "object") args = raw;
        } catch {
            // ignore
        }
        const ephemeral = args?.ephemeral !== false;

        if (redis && tenantKey) {
            const cacheKey = `${FUEL_CACHE_KEY_PREFIX}${tenantKey}`;
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    const data = JSON.parse(cached);
                    log.info("[cmd:연료] 캐시 히트", { tenantKey });
                    return {
                        ok: true,
                        data: { ...data, ephemeralReply: ephemeral },
                    };
                }
            } catch {
                // 캐시 파싱 실패 시 조회 진행
            }
        }

        if (!prisma) {
            log.warn("[cmd:연료] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류", ephemeralReply: ephemeral } };
        }

        const pairs = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS);
        if (pairs.length === 0) {
            return {
                ok: false,
                data: {
                    error: "연료 조회용 캐릭터 설정이 없습니다. (EVE_ANCHOR_CHARIDS)",
                    ephemeralReply: ephemeral,
                },
            };
        }

        const allStructures = [];
        for (const { corporationId, characterId } of pairs) {
            const accessToken = await getAccessTokenForCharacter(prisma, characterId);
            if (!accessToken) {
                log.warn("[cmd:연료] 토큰 없음", {
                    corporationId,
                    characterId: String(characterId),
                });
                continue;
            }
            const list = await getCorporationStructures(corporationId, accessToken);
            if (list && list.length > 0) {
                allStructures.push(...list);
            }
        }

        if (allStructures.length === 0) {
            return {
                ok: false,
                data: {
                    error: "스트럭쳐 정보가 없어요. 나중에 다시 시도해 주세요.",
                    ephemeralReply: ephemeral,
                },
            };
        }

        const now = new Date();
        const tableRows = allStructures.map((structure) => {
            const { name, fuel_expires, type_id } = structure;
            const expiresDate = new Date(fuel_expires);
            const remainingDays = Math.ceil((expiresDate - now) / (1000 * 60 * 60 * 24));
            const buildingType = structureTypeMapping[type_id] || {
                name: "알 수 없음",
                emoji: ":question:",
            };
            const displayType = `${buildingType.emoji} ${buildingType.name}`;
            return { name, type: displayType, remainingDays };
        });

        const nameValue = tableRows.map((r) => r.name).join("\n") || "정보 없음";
        const typeValue = tableRows.map((r) => r.type).join("\n") || "정보 없음";
        const daysValue =
            tableRows
                .map((row) => {
                    const d = row.remainingDays;
                    const statusEmoji = d <= 0 ? "⚫" : d <= 10 ? "🔴" : d <= 30 ? "🟡" : "🟢";
                    const daysText = d <= 0 ? "0일 남음" : `${d}일 남음`;
                    return `${statusEmoji} ${daysText}`;
                })
                .join("\n") || "정보 없음";

        const fields = [
            { name: "건물 이름", value: nameValue, inline: true },
            { name: "건물 유형", value: typeValue, inline: true },
            { name: "⏳ 남은 일수", value: daysValue, inline: true },
        ];

        log.info("[cmd:연료] 조회 완료", { tenantKey, structures: allStructures.length });

        const data = {
            embed: true,
            embeds: [
                {
                    title: "현재 스트럭쳐 연료 상태",
                    description: "다음은 각 스트럭쳐의 연료 상태입니다.",
                    fields,
                    color: 0x800080,
                    timestamp: false,
                },
            ],
            ephemeralReply: ephemeral,
        };

        if (redis && tenantKey) {
            const cacheKey = `${FUEL_CACHE_KEY_PREFIX}${tenantKey}`;
            const cachePayload = {
                embed: data.embed,
                embeds: data.embeds,
            };
            try {
                await redis.set(cacheKey, JSON.stringify(cachePayload), {
                    EX: FUEL_CACHE_TTL_SEC,
                });
            } catch (e) {
                log.warn("[cmd:연료] 캐시 저장 실패", { tenantKey, message: e?.message });
            }
        }

        return { ok: true, data };
    },
};
