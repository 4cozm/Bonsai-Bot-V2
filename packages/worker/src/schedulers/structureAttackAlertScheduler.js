// packages/worker/src/schedulers/structureAttackAlertScheduler.js
// ESI character notifications를 주기적으로 조회하여 건물 공격 알림을 Discord 웹후크로 전송.

import cron from "node-cron";
import {
    getAccessTokenForCharacter,
    parseAnchorCharIds,
    logger,
    postDiscordWebhook,
} from "@bonsai/shared";

const ESI_NOTIFICATIONS_BASE = "https://esi.evetech.net/latest/characters";
const REDIS_KEY_PREFIX = "bonsai:structure_alert:max_notification_id";
const CRON_SCHEDULE = "*/10 * * * *"; // 10분마다 (ESI 10분 캐싱)

const IGNORE_CORP_NAMES = [
    "Blood Raiders",
    "Guristas Pirates",
    "Serpentis",
    "Sansha's Nation",
    "Angel Cartel",
    "Rogue Drones",
    "Guristas",
];

/**
 * Redis 키: 테넌트+캐릭터별 마지막 처리 notification_id
 * @param {string} tenantKey
 * @param {string | bigint} characterId
 */
function redisKey(tenantKey, characterId) {
    return `${REDIS_KEY_PREFIX}:${tenantKey}:${String(characterId)}`;
}

/**
 * ESI에서 캐릭터 notifications 조회
 * @param {string} characterId - EVE character ID
 * @param {string} accessToken - Bearer token
 * @returns {Promise<{ notification_id: number, type: string, text?: string }[] | null>}
 */
async function fetchCharacterNotifications(characterId, accessToken) {
    const url = `${ESI_NOTIFICATIONS_BASE}/${characterId}/notifications/`;
    const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return res.json();
}

/**
 * 알림 타입별 Discord 임베드 생성 후 웹후크 전송
 * @param {{ url: string, log: { warn: Function } }} params
 * @param {string} type - TowerAlertMsg | StructureUnderAttack | StructureLostShields | StructureLostArmor
 * @param {string} [text] - notification.text (StructureUnderAttack 시 파싱용)
 */
async function sendAlertEmbed({ url, log }, type, text = "") {
    if (!url) {
        log.warn("[structure-attack-alert] DISCORD_ALERT_WEBHOOK_URL 미설정 - 전송 스킵");
        return;
    }

    let embed;
    switch (type) {
        case "TowerAlertMsg":
            embed = {
                title: "포스 공격 알림",
                description: "@everyone 포스가 공격받고 있습니다.",
                color: 0xff0000,
                timestamp: new Date().toISOString(),
            };
            break;
        case "StructureUnderAttack": {
            const corpMatch = text.match(/corpName: (.+)/);
            const shieldMatch = text.match(/shieldPercentage: ([\d.]+)/);
            const armorMatch = text.match(/armorPercentage: ([\d.]+)/);
            const hullMatch = text.match(/hullPercentage: ([\d.]+)/);
            const corpName = corpMatch ? corpMatch[1].trim() : "알 수 없음";
            if (IGNORE_CORP_NAMES.includes(corpName)) {
                log.warn("[structure-attack-alert] 알림 무시 (무시 목록 코퍼레이션)", {
                    corpName,
                });
                return;
            }
            const shield = shieldMatch ? parseInt(shieldMatch[1], 10) : null;
            const armor = armorMatch ? parseInt(armorMatch[1], 10) : null;
            const hull = hullMatch ? parseInt(hullMatch[1], 10) : null;
            embed = {
                title: "건물 공격 알림",
                description: "@everyone 건물이 공격받고 있습니다!",
                fields: [
                    { name: "공격자 코퍼레이션", value: corpName, inline: true },
                    {
                        name: "남은 실드",
                        value: shield != null ? `${shield}%` : "N/A",
                        inline: true,
                    },
                    {
                        name: "남은 아머",
                        value: armor != null ? `${armor}%` : "N/A",
                        inline: true,
                    },
                    {
                        name: "남은 헐",
                        value: hull != null ? `${hull}%` : "N/A",
                        inline: true,
                    },
                ],
                color: 0xff0000,
                timestamp: new Date().toISOString(),
            };
            break;
        }
        case "StructureLostShields":
            embed = {
                title: "건물 실드 파괴",
                description: "@everyone 건물 실드가 파괴되었습니다.",
                color: 0xff0000,
                timestamp: new Date().toISOString(),
            };
            break;
        case "StructureLostArmor":
            embed = {
                title: "건물 아머 파괴",
                description: "@everyone 건물 아머가 파괴되었습니다.",
                color: 0xff0000,
                timestamp: new Date().toISOString(),
            };
            break;
        default:
            return;
    }

    try {
        await postDiscordWebhook({ url, payload: { embeds: [embed] } });
    } catch (e) {
        log.warn("[structure-attack-alert] 웹후크 전송 실패", { message: e?.message });
    }
}

/**
 * 한 캐릭터에 대해 notifications 조회 → 멱등 처리 → 알림 전송
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {import("@prisma/client").PrismaClient} params.prisma
 * @param {string} params.tenantKey
 * @param {bigint} params.characterId
 * @param {{ info: Function, warn: Function, error: Function }} params.log
 */
async function processCharacterNotifications({ redis, prisma, tenantKey, characterId, log }) {
    const accessToken = await getAccessTokenForCharacter(prisma, characterId);
    if (!accessToken) {
        log.warn("[structure-attack-alert] 토큰 없음, 캐릭터 스킵", {
            tenantKey,
            characterId: String(characterId),
        });
        return;
    }

    const data = await fetchCharacterNotifications(String(characterId), accessToken);
    if (!data || !Array.isArray(data)) {
        log.warn("[structure-attack-alert] ESI notifications 조회 실패 또는 비배열", {
            characterId: String(characterId),
        });
        return;
    }

    const key = redisKey(tenantKey, characterId);
    let maxIdRaw = await redis.get(key);
    const maxId = maxIdRaw != null ? Number(maxIdRaw) : null;

    // 첫 실행: 해당 캐릭터 키가 없으면 이번 목록에서 최대 id만 저장하고 알림 없음
    if (maxId == null) {
        if (data.length === 0) return;
        const topId = data[0].notification_id;
        await redis.set(key, String(topId));
        log.info("[structure-attack-alert] 첫 실행 - maxNotificationId 설정 (알림 없음)", {
            tenantKey,
            characterId: String(characterId),
            topId,
        });
        return;
    }

    const webhookUrl = String(process.env.DISCORD_ALERT_WEBHOOK_URL ?? "").trim();
    let processedMax = maxId;

    for (const notification of data) {
        if (notification.notification_id <= maxId) break;

        const notificationType = notification.type || "";
        await sendAlertEmbed({ url: webhookUrl, log }, notificationType, notification.text ?? "");
        processedMax = Math.max(processedMax, notification.notification_id);
    }

    if (processedMax > maxId) {
        await redis.set(key, String(processedMax));
    }
}

/**
 * 건물 공격 알림 크론 스케줄러 기동.
 * - EVE_ANCHOR_CHARIDS 전체 캐릭터에 대해 notifications 조회, 캐릭터별 Redis 멱등 후 Discord 웹후크 전송.
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {import("@prisma/client").PrismaClient} params.prisma
 * @param {string} params.tenantKey
 * @param {AbortSignal} [params.signal] - abort 시 cron 중단
 * @param {{ info: Function, warn: Function, error: Function }} [params.log]
 */
export function startStructureAttackAlertScheduler({ redis, prisma, tenantKey, signal, log }) {
    const logInstance = log ?? logger();

    const pairs = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS);
    if (pairs.length === 0) {
        logInstance.warn(
            "[structure-attack-alert] EVE_ANCHOR_CHARIDS 비어있음 - 스케줄러는 등록되나 매 실행 시 스킵"
        );
    }

    const task = cron.schedule(CRON_SCHEDULE, async () => {
        if (signal?.aborted) return;

        const tenantPairs = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS);
        if (tenantPairs.length === 0) return;

        for (const { characterId } of tenantPairs) {
            if (signal?.aborted) return;
            try {
                await processCharacterNotifications({
                    redis,
                    prisma,
                    tenantKey,
                    characterId,
                    log: logInstance,
                });
            } catch (err) {
                logInstance.error("[structure-attack-alert] 캐릭터 처리 중 오류", {
                    characterId: String(characterId),
                    message: err?.message,
                });
            }
        }
    });

    if (signal) {
        signal.addEventListener(
            "abort",
            () => {
                task.stop();
            },
            { once: true }
        );
    }

    logInstance.info("[structure-attack-alert] 건물 공격 알림 cron 등록 완료 (10분마다)");
}
