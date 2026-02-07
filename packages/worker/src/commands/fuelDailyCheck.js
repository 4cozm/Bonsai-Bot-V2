// packages/worker/src/commands/fuelDailyCheck.js
import {
    getAccessTokenForCharacter,
    parseAnchorCharIds,
    logger,
    postDiscordWebhook,
} from "@bonsai/shared";
import { getCorporationStructures } from "../esi/getCorporationStructures.js";
import { structureTypeMapping } from "../esi/structureTypeMapping.js";

const log = logger();

const DEFAULT_ALERT_DAYS = 30;

/**
 * 연료-일일체크: 스케줄에서 호출. 연료 부족 건물만 웹후크, 전부 안전 시 채널 브로드캐스트 메타 반환.
 */
export default {
    name: "연료-일일체크",
    discord: null,

    /**
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {string} ctx.tenantKey
     * @param {object} envelope
     * @param {object} [envelope.meta]
     * @returns {Promise<{ok: boolean, data: any, meta?: object}>}
     */
    async execute(ctx, envelope) {
        const prisma = ctx?.prisma;
        const meta = envelope?.meta ?? {};
        const channelId = String(meta.channelId ?? "").trim();
        const guildId = String(meta.guildId ?? "").trim();
        const webhookUrl = String(process.env.DISCORD_ALERT_WEBHOOK_URL ?? "").trim();
        const alertDays = Number(process.env.FUEL_ALERT_DAYS ?? DEFAULT_ALERT_DAYS);

        if (!prisma) {
            log.warn("[cmd:연료-일일체크] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }

        const pairs = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS);
        if (pairs.length === 0) {
            if (webhookUrl) {
                try {
                    await postDiscordWebhook({
                        url: webhookUrl,
                        payload: {
                            content:
                                "연료 일일체크: 연료 조회용 캐릭터 설정이 없습니다. (EVE_ANCHOR_CHARIDS)",
                        },
                    });
                } catch (e) {
                    log.warn("[cmd:연료-일일체크] 웹후크 전송 실패", { message: e?.message });
                }
            }
            return {
                ok: false,
                data: { error: "연료 조회용 캐릭터 설정이 없습니다. (EVE_ANCHOR_CHARIDS)" },
            };
        }

        const allStructures = [];
        for (const { corporationId, characterId } of pairs) {
            const accessToken = await getAccessTokenForCharacter(prisma, characterId);
            if (!accessToken) {
                log.warn("[cmd:연료-일일체크] 토큰 없음", {
                    corporationId,
                    characterId: String(characterId),
                });
                continue;
            }
            const list = await getCorporationStructures(corporationId, accessToken);
            if (list && list.length > 0) allStructures.push(...list);
        }

        if (allStructures.length === 0) {
            if (webhookUrl) {
                try {
                    await postDiscordWebhook({
                        url: webhookUrl,
                        payload: {
                            content:
                                "스트럭쳐 연료량 자동 검사중 스트럭쳐 정보를 가져오지 못했어요. ESI가 아플지두?..",
                        },
                    });
                } catch (e) {
                    log.warn("[cmd:연료-일일체크] 웹후크 전송 실패", { message: e?.message });
                }
            }
            return {
                ok: false,
                data: { error: "스트럭쳐 정보가 없어요. 나중에 다시 시도해 주세요." },
            };
        }

        const now = new Date();
        const lowStructures = [];
        for (const structure of allStructures) {
            const { name, fuel_expires, type_id } = structure;
            const expiresDate = new Date(fuel_expires);
            const remainingDays = Math.ceil((expiresDate - now) / (1000 * 60 * 60 * 24));
            if (remainingDays <= alertDays) {
                const buildingType = structureTypeMapping[type_id] || {
                    name: "알 수 없음",
                    emoji: ":question:",
                };
                const displayType = `${buildingType.emoji} ${buildingType.name}`;
                lowStructures.push({
                    name,
                    displayType,
                    remainingDays,
                });
            }
        }

        if (lowStructures.length > 0) {
            if (webhookUrl) {
                const lines = lowStructures.map(
                    (s) => `연료가 ${s.remainingDays}일 남았습니다 ${s.name}(${s.displayType})`
                );
                try {
                    await postDiscordWebhook({
                        url: webhookUrl,
                        payload: {
                            content: lines.join("\n"),
                        },
                    });
                } catch (e) {
                    log.warn("[cmd:연료-일일체크] 웹후크 전송 실패", { message: e?.message });
                }
            }
            return {
                ok: true,
                data: { alerted: lowStructures.length, structures: lowStructures },
            };
        }

        // 전부 안전: 웹후크 없이 Master 채널 브로드캐스트 메타만 반환
        const message = "연료 검사 완료! 현재 모든 건물의 연료가 안전 범위 입니다.";
        return {
            ok: true,
            data: { message },
            meta: {
                broadcastToChannel: true,
                channelId,
                guildId,
            },
        };
    },
};
