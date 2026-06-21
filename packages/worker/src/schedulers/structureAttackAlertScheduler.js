// packages/worker/src/schedulers/structureAttackAlertScheduler.js
// ESI character notifications를 주기적으로 조회하여 건물 공격 알림을 Discord 웹후크로 전송.

import cron from "node-cron";
import {
    getAccessTokenForCharacter,
    parseAnchorCharIds,
    logger,
    postDiscordWebhook,
} from "@bonsai/shared";
import { structureTypeMapping } from "../esi/structureTypeMapping.js";
import { getCorporationStructureMap } from "../esi/getCorporationStructureMap.js";
import { getSolarSystemName } from "../esi/getSolarSystemName.js";
import { getTypeName } from "../esi/getTypeName.js";

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
 * notification.text(YAML)에서 키 하나 파싱 (key: value 형식, 한 줄)
 * - 줄 시작에 고정(^\s*key:)해 다른 키의 부분일치를 막는다(예: "typeID"가 "structureTypeID:"에 오매칭).
 * - i 플래그로 대소문자 차이를 흡수: TowerAlertMsg는 "solarSystemID"(대문자 S), 그 외 타입은
 *   "solarsystemID"(소문자)로 와서, 같은 코드로 양쪽을 처리하려면 필요.
 * @param {string} text
 * @param {string} key - 예: "structureTypeID", "typeID", "solarsystemID"
 * @returns {string | null}
 */
export function parseTextKey(text, key) {
    const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "im");
    const m = String(text ?? "").match(re);
    const raw = m ? m[1].trim() : null;
    if (raw == null || raw === "") return null;
    return raw;
}

/**
 * parseTextKey 결과에서 숫자 ID만 추출.
 * StructureUnderAttack의 structureID는 YAML anchor가 붙어 "&id001 1000000000001" 형태로 옴.
 * 값 끝의 연속 숫자만 뽑아 문자열로 반환(큰 ID 정밀도 보존, 맵 키 비교용).
 * @param {string | null} raw
 * @returns {string | null}
 */
export function extractNumericId(raw) {
    const m = String(raw ?? "").match(/(\d+)\s*$/);
    return m ? m[1] : null;
}

/**
 * 알림 text의 structureID/solarsystemID를 건물 이름·성계 이름으로 해석.
 * - 건물 이름: 코프 구조물 목록(name 포함, esi-corporations.read_structures.v1)에서 조회.
 * - 성계 이름: 공개 universe/systems 엔드포인트. structureID로 system_id를 못 찾으면 text의 solarsystemID 사용.
 * @param {{ redis: any, prisma: any, corporationId: number, characterId: bigint, log: { warn: Function } }} ctx
 * @param {string} text
 * @returns {Promise<{ structureName: string | null, systemName: string | null }>}
 */
async function resolveStructureLocation(ctx, text) {
    const { redis, prisma, corporationId, characterId, log } = ctx;
    const structureId = extractNumericId(parseTextKey(text, "structureID"));
    let systemId = extractNumericId(parseTextKey(text, "solarsystemID"));
    let structureName = null;

    if (structureId && corporationId) {
        try {
            const map = await getCorporationStructureMap({
                redis,
                prisma,
                corporationId,
                characterId,
                log,
            });
            const info = map[structureId];
            if (info) {
                structureName = info.name ?? null;
                if (!systemId && info.system_id != null) systemId = String(info.system_id);
            }
        } catch (e) {
            log.warn("[structure-attack-alert] 건물 이름 조회 실패", { message: e?.message });
        }
    }

    const systemName = systemId ? await getSolarSystemName(redis, systemId) : null;
    return { structureName, systemName };
}

const HANDLED_TYPES = new Set([
    "TowerAlertMsg",
    "StructureUnderAttack",
    "StructureLostShields",
    "StructureLostArmor",
]);

/**
 * 백분율 키 파싱. shieldPercentage 등은 0에 가까울 때 지수 표기(예: 4.7e-14)로 오므로
 * parseFloat + Math.round로 정수 %를 만든다. (기존 parseInt는 "4.7e-14"를 4로 잘못 읽음.)
 * @param {string} text
 * @param {string} key
 * @returns {number | null}
 */
function parsePercentage(text, key) {
    const m = String(text ?? "").match(new RegExp(`${key}:\\s*([0-9eE.+-]+)`));
    if (!m) return null;
    const v = parseFloat(m[1]);
    return Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * typeID/structureTypeID → 타입 이름 해석.
 * 1) 큐레이션된 structureTypeMapping(한글명+이모지) 우선.
 * 2) 없으면 ESI 공개 엔드포인트로 폴백(Redis 캐싱) — POS 컨트롤 타워 등 매핑 미등록 타입 대응.
 * @param {import("redis").RedisClientType | null | undefined} redis
 * @param {string | null} typeIdRaw
 * @returns {Promise<string | null>}
 */
export async function resolveTypeName(redis, typeIdRaw) {
    if (typeIdRaw == null) return null;
    const id = Number(typeIdRaw);
    if (!Number.isInteger(id) || id <= 0) return null;
    const mapped = structureTypeMapping[id];
    if (mapped?.name) return mapped.name;
    return getTypeName(redis, id);
}

/**
 * 건물 필드 값 구성. 이름이 있으면 강조, 없으면 "(이름 미확인)" + 유형.
 * @param {string | null} structureName
 * @param {string | null} structureTypeName
 * @returns {string}
 */
function buildingFieldValue(structureName, structureTypeName) {
    if (structureName) {
        return structureTypeName
            ? `**${structureName}** (${structureTypeName})`
            : `**${structureName}**`;
    }
    return structureTypeName ? `(이름 미확인 · ${structureTypeName})` : "(이름 미확인)";
}

/**
 * 테넌트 + 위치(성계) 세부 라인.
 * @param {string} tenantLabel
 * @param {string | null} systemName
 * @returns {string}
 */
function detailLine(tenantLabel, systemName) {
    const parts = [];
    if (tenantLabel) parts.push(tenantLabel);
    parts.push(`위치: ${systemName ? `**${systemName}**` : "알 수 없음"}`);
    return parts.join(" · ");
}

/**
 * 알림 타입별 Discord 웹후크 전송.
 * 멘션(@everyone)은 content에 넣어야 알림이 트리거됨. 임베드 안의 멘션은 Discord 정책상 알림을 주지 않음.
 * 테넌트·건물 이름·성계 위치를 임베드에 넣어 어떤 건물인지 구분 가능하게 함.
 * @param {{ url: string, log: { warn: Function }, redis: any, prisma: any, corporationId: number, characterId: bigint }} params
 * @param {string} type - TowerAlertMsg | StructureUnderAttack | StructureLostShields | StructureLostArmor
 * @param {string} [text] - notification.text (구조물 ID/위치 파싱용)
 * @param {string} [tenantKey] - 테넌트 식별자 (CAT, FISH 등)
 */
async function sendAlertEmbed(params, type, text = "", tenantKey = "") {
    const { url, log } = params;
    if (!url) {
        log.warn("[structure-attack-alert] DISCORD_ALERT_WEBHOOK_URL 미설정 - 전송 스킵");
        return;
    }
    if (!HANDLED_TYPES.has(type)) return;

    const tenantLabel = tenantKey ? `테넌트: **${tenantKey}**` : "";
    const ctx = {
        redis: params.redis,
        prisma: params.prisma,
        corporationId: params.corporationId,
        characterId: params.characterId,
        log,
    };

    let embed;
    switch (type) {
        case "TowerAlertMsg": {
            // POS(스타베이스)는 Upwell 구조물이 아니라 코프 구조물 목록에 없어 이름 해석 불가.
            // 성계 위치는 solarsystemID로 조회 가능.
            const { systemName } = await resolveStructureLocation(ctx, text);
            const typeIdRaw = parseTextKey(text, "typeID");
            const structureTypeName = await resolveTypeName(params.redis, typeIdRaw);
            embed = {
                title: "포스 공격 알림",
                description: "포스가 공격받고 있습니다.",
                fields: [
                    {
                        name: "포스",
                        value: buildingFieldValue(null, structureTypeName),
                        inline: false,
                    },
                    {
                        name: "세부 정보",
                        value: detailLine(tenantLabel, systemName),
                        inline: false,
                    },
                ],
                color: 0xff0000,
                timestamp: new Date().toISOString(),
            };
            break;
        }
        case "StructureUnderAttack": {
            const corpMatch = text.match(/corpName: (.+)/);
            const corpName = corpMatch ? corpMatch[1].trim() : "알 수 없음";
            if (IGNORE_CORP_NAMES.includes(corpName)) {
                log.warn("[structure-attack-alert] 알림 무시 (무시 목록 코퍼레이션)", {
                    corpName,
                });
                return;
            }
            const { structureName, systemName } = await resolveStructureLocation(ctx, text);
            const shield = parsePercentage(text, "shieldPercentage");
            const armor = parsePercentage(text, "armorPercentage");
            const hull = parsePercentage(text, "hullPercentage");
            const structureTypeIdRaw = parseTextKey(text, "structureTypeID");
            const structureTypeName = await resolveTypeName(params.redis, structureTypeIdRaw);
            embed = {
                title: "건물 공격 알림",
                description: "건물이 공격받고 있습니다.",
                fields: [
                    {
                        name: "건물",
                        value: buildingFieldValue(structureName, structureTypeName),
                        inline: false,
                    },
                    {
                        name: "세부 정보",
                        value: detailLine(tenantLabel, systemName),
                        inline: false,
                    },
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
        case "StructureLostArmor": {
            const isShields = type === "StructureLostShields";
            const { structureName, systemName } = await resolveStructureLocation(ctx, text);
            const structureTypeIdRaw = parseTextKey(text, "structureTypeID");
            const structureTypeName = await resolveTypeName(params.redis, structureTypeIdRaw);
            embed = {
                title: isShields ? "건물 실드 파괴" : "건물 아머 파괴",
                description: isShields
                    ? "건물 실드가 파괴되었습니다."
                    : "건물 아머가 파괴되었습니다.",
                fields: [
                    {
                        name: "건물",
                        value: buildingFieldValue(structureName, structureTypeName),
                        inline: false,
                    },
                    {
                        name: "세부 정보",
                        value: detailLine(tenantLabel, systemName),
                        inline: false,
                    },
                ],
                color: 0xff0000,
                timestamp: new Date().toISOString(),
            };
            break;
        }
        default:
            return;
    }

    // content에 @everyone을 넣어야 실제 멘션 알림이 감. 임베드 안 멘션은 알림 미트리거(Discord 문서)
    const payload = { content: "@everyone", embeds: [embed] };

    try {
        await postDiscordWebhook({ url, payload });
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
 * @param {number} params.corporationId
 * @param {bigint} params.characterId
 * @param {{ info: Function, warn: Function, error: Function }} params.log
 */
async function processCharacterNotifications({
    redis,
    prisma,
    tenantKey,
    corporationId,
    characterId,
    log,
}) {
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
        await sendAlertEmbed(
            { url: webhookUrl, log, redis, prisma, corporationId, characterId },
            notificationType,
            notification.text ?? "",
            tenantKey
        );
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

        for (const { corporationId, characterId } of tenantPairs) {
            if (signal?.aborted) return;
            try {
                await processCharacterNotifications({
                    redis,
                    prisma,
                    tenantKey,
                    corporationId,
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
