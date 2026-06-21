// packages/worker/src/commands/attackNotifDump.js
// dev 전용 진단 명령: 최근 건물/포스 공격 알림의 ESI 원본을 Discord로 덤프한다.
// 슬래시 명령으로 등록하지 않고(`discord` 필드 없음) `/dev cmd:attackDump` 로만 호출.
//
// 목적: 알림 text(YAML) 파싱이 실패할 때, 실제 ESI가 내려주는 원본 구조/문자열을 눈으로
// 확인해 파서를 고치기 위함. notification 메타(JSON)와 text(raw, 줄바꿈 보존)를 함께 보여준다.
//
// 사용: /dev cmd:attackDump            → 최근 공격 알림 1건
//       /dev cmd:attackDump args:3     → 최근 공격 알림 3건
//       /dev cmd:attackDump args:all   → 타입 필터 없이 최근 알림 1건(어떤 타입이 오는지 확인)
//       /dev cmd:attackDump args:"all 3" → 타입 무관 최근 3건

import { getAccessTokenForCharacter, parseAnchorCharIds, logger } from "@bonsai/shared";

const log = logger();

const ESI_NOTIFICATIONS_BASE = "https://esi.evetech.net/latest/characters";
const DISCORD_EMBED_DESC_MAX = 4096;
const DESC_BUDGET = 3900; // 안전 여유
const MAX_COUNT = 5;

// 스케줄러 HANDLED_TYPES와 동일 (건물/포스 공격 관련)
const ATTACK_TYPES = new Set([
    "TowerAlertMsg",
    "StructureUnderAttack",
    "StructureLostShields",
    "StructureLostArmor",
]);

/**
 * ESI에서 캐릭터 notifications 조회
 * @param {string} characterId
 * @param {string} accessToken
 * @returns {Promise<any[] | null>}
 */
async function fetchNotifications(characterId, accessToken) {
    const url = `${ESI_NOTIFICATIONS_BASE}/${characterId}/notifications/`;
    const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return res.json();
}

/**
 * envelope.args에서 실제 args 문자열을 뽑는다.
 * - dev 포워딩 경로: 그냥 문자열("all 3").
 * - prod 슬래시 경로: serializeOptions가 만든 JSON({"args":"all 3"}).
 * @param {string} raw
 * @returns {string}
 */
function readArgsString(raw) {
    const text = String(raw ?? "").trim();
    if (text.startsWith("{") && text.endsWith("}")) {
        try {
            const o = JSON.parse(text);
            return o?.args == null ? "" : String(o.args);
        } catch {
            // fallthrough: 원문 사용
        }
    }
    return text;
}

/**
 * args 파싱: "all"/"전체" 포함 여부와 count(정수) 추출.
 * @param {string} raw
 * @returns {{ count: number, includeAll: boolean }}
 */
function parseArgs(raw) {
    const text = String(raw ?? "").trim();
    const includeAll = /\ball\b|전체/i.test(text);
    const m = text.match(/\d+/);
    let count = m ? Number(m[0]) : 1;
    if (!Number.isInteger(count) || count < 1) count = 1;
    if (count > MAX_COUNT) count = MAX_COUNT;
    return { count, includeAll };
}

/**
 * 한 notification을 사람이 보기 좋은 블록으로 직렬화.
 * 메타는 JSON, text는 raw(줄바꿈 보존) 코드블록으로 분리.
 * @param {any} n
 * @returns {string}
 */
function formatNotification(n) {
    const { text, ...meta } = n ?? {};
    const metaJson = JSON.stringify(meta, null, 2);
    const textBlock =
        typeof text === "string" && text.length > 0
            ? `\n**text (raw):**\n\`\`\`yaml\n${text}\n\`\`\``
            : "\n**text:** (없음)";
    return `**메타:**\n\`\`\`json\n${metaJson}\n\`\`\`${textBlock}`;
}

export default {
    // 슬래시 명령으로 노출하므로 name === discord.name 이어야 prod 디스패치에서 찾힌다(소문자 필수).
    name: "attackdump",

    // TEMP(테스트용): prod 워커에만 ESI 토큰이 있어 /dev(=로컬 라우팅)로는 호출 불가.
    // 임시로 정식 슬래시 명령으로 등록해 prod에서 호출/테스트한다.
    // 테스트가 끝나면 이 discord 블록을 제거해 다시 /dev 전용(비노출)으로 되돌릴 것.
    discord: {
        name: "attackdump",
        description: "[임시/진단] 최근 건물 공격 알림의 ESI 원본을 덤프",
        type: 1,
        // 임시 테스트용이라 권한 제한 없음(출력은 ephemeral, 민감 정보 아님). 테스트 후 블록째 제거.
        options: [
            {
                type: 3, // STRING
                name: "args",
                description: '예: "3"=최근 3건, "all"=타입무관, "all 5"=타입무관 5건',
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
        const tenantKey = String(ctx?.tenantKey ?? "").trim();
        const { count, includeAll } = parseArgs(readArgsString(envelope?.args));

        const pairs = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS);
        if (pairs.length === 0) {
            return { ok: false, data: { error: "attackDump: EVE_ANCHOR_CHARIDS 비어있음" } };
        }

        const collected = [];
        const notes = [];

        for (const { characterId } of pairs) {
            const charIdStr = String(characterId);
            let accessToken;
            try {
                accessToken = await getAccessTokenForCharacter(prisma, characterId);
            } catch (e) {
                notes.push(`char ${charIdStr}: 토큰 조회 오류(${e?.message ?? "?"})`);
                continue;
            }
            if (!accessToken) {
                notes.push(`char ${charIdStr}: 토큰 없음`);
                continue;
            }

            const data = await fetchNotifications(charIdStr, accessToken);
            if (!Array.isArray(data)) {
                notes.push(`char ${charIdStr}: notifications 조회 실패`);
                continue;
            }

            const matched = includeAll ? data : data.filter((n) => ATTACK_TYPES.has(n?.type));
            for (const n of matched) collected.push({ ...n, _charId: charIdStr });
            notes.push(
                `char ${charIdStr}: 총 ${data.length}건, ${
                    includeAll ? "전체" : "공격타입"
                } ${matched.length}건`
            );
        }

        log.info(
            `[cmd:attackDump] tenant=${tenantKey} chars=${pairs.length} collected=${collected.length} includeAll=${includeAll} count=${count}`
        );

        if (collected.length === 0) {
            const present = notes.join("\n");
            return {
                ok: true,
                data: {
                    embed: true,
                    title: "공격 알림 덤프 — 결과 없음",
                    description: `${includeAll ? "최근 알림" : "공격 타입 알림"}을 찾지 못함.\n\n${present}`,
                    color: 0xfaa61a,
                },
            };
        }

        // 최신순(notification_id 내림차순) 정렬 후 count개
        collected.sort((a, b) => Number(b.notification_id) - Number(a.notification_id));
        const picked = collected.slice(0, count);

        const header = `테넌트: **${tenantKey}** · ${
            includeAll ? "타입 무관" : "공격 타입"
        } 최근 ${picked.length}건 (수집 ${collected.length}건)\n`;

        let description = header;
        let truncated = false;
        for (let i = 0; i < picked.length; i++) {
            const n = picked[i];
            const charId = n._charId;
            const clean = { ...n };
            delete clean._charId;
            const block = `\n__#${i + 1} · char ${charId} · ${n.type} · id ${n.notification_id}__\n${formatNotification(clean)}\n`;
            if (description.length + block.length > DESC_BUDGET) {
                truncated = true;
                break;
            }
            description += block;
        }
        if (truncated) {
            description += "\n…(길이 제한으로 일부 생략 — args 숫자를 줄이세요)";
        }
        if (description.length > DISCORD_EMBED_DESC_MAX) {
            description = description.slice(0, DISCORD_EMBED_DESC_MAX - 1) + "…";
        }

        return {
            ok: true,
            data: {
                embed: true,
                title: "공격 알림 ESI 원본 덤프",
                description,
                footer: notes.join(" | ").slice(0, 2000),
                color: 0x5865f2,
            },
        };
    },
};
