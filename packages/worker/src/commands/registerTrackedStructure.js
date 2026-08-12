// packages/worker/src/commands/registerTrackedStructure.js
import { logger, parseAnchorCharIds } from "@bonsai/shared";
import { syncStructure } from "../schedulers/stockSyncScheduler.js";

const log = logger();

// 임시 하드코딩 — esiAssetDebug.js와 동일한 이유(정식 관리자 인증 흐름이 아직 없음).
// /보급 매직링크 기반 관리자 인증이 붙으면 테넌트별 관리자 배열로 옮긴다.
const ALLOWED_DISCORD_IDS = new Set(["378543198953406464"]);

function parseArgs(rawArgs) {
    try {
        const obj = JSON.parse(String(rawArgs ?? "").trim() || "{}");
        return obj && typeof obj === "object" ? obj : {};
    } catch {
        return {};
    }
}

export default {
    name: "재고구조물등록",
    discord: {
        name: "재고구조물등록",
        description: "[관리자 전용] 재고 동기화 대상 구조물 등록/수정",
        type: 1,
        options: [
            {
                type: 3, // STRING (item_id가 커서 INTEGER 옵션은 클라이언트에서 반올림될 수 있다)
                name: "구조물",
                description: "구조물 item_id (예: SAVE CAT = 1051025995560)",
                required: true,
            },
            {
                type: 4, // INTEGER — corp_id는 32비트 범위 안이라 안전
                name: "콥",
                description:
                    "콥행어(오피스)를 실제로 들고 있는 콥 ID — 구조물 소유 콥과 다를 수 있음",
                required: true,
            },
            {
                type: 3, // STRING
                name: "이름",
                description: "표시용 이름 (예: SAVE CAT)",
                required: true,
            },
            {
                type: 5, // BOOLEAN
                name: "활성",
                description:
                    "재고 동기화 크론 대상 여부 (기본: true). 구조물 파괴/철거 시 false로 끄기",
                required: false,
            },
        ],
    },

    /**
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const discordUserId = String(envelope?.meta?.discordUserId ?? "").trim();
        if (!ALLOWED_DISCORD_IDS.has(discordUserId)) {
            log.warn(`[cmd:재고구조물등록] 허용되지 않은 사용자 discordUserId=${discordUserId}`);
            return {
                ok: false,
                data: { error: "이 명령은 사용할 수 없습니다.", ephemeralReply: true },
            };
        }

        const prisma = ctx?.prisma;
        if (!prisma) {
            log.warn("[cmd:재고구조물등록] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류", ephemeralReply: true } };
        }

        const {
            구조물: structureIdRaw,
            콥: corporationId,
            이름: displayName,
            활성: activeOpt,
        } = parseArgs(envelope?.args);

        let structureId;
        try {
            structureId = BigInt(String(structureIdRaw ?? "").trim());
        } catch {
            return {
                ok: false,
                data: { error: "구조물 item_id가 올바른 정수가 아닙니다.", ephemeralReply: true },
            };
        }

        const active = activeOpt ?? true;

        const row = await prisma.trackedStructure.upsert({
            where: { structureId },
            create: { structureId, corporationId, displayName, active },
            update: { corporationId, displayName, active },
        });

        log.info("[cmd:재고구조물등록] upsert 완료", {
            structureId: String(row.structureId),
            corporationId: row.corporationId,
            displayName: row.displayName,
            active: row.active,
        });

        // 등록 직후 1회성으로 바로 조회해서, 정각 크론까지(최대 1시간) 기다리지
        // 않고도 등록이 실제로 맞게 됐는지 바로 확인할 수 있게 한다.
        let syncLine = "동기화: 비활성 상태라 스킵";
        if (row.active) {
            const anchor = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS).find(
                (a) => a.corporationId === row.corporationId
            );
            if (!anchor) {
                syncLine = `⚠️ 동기화: EVE_ANCHOR_CHARIDS에 corporationId=${row.corporationId} 앵커가 없음`;
            } else {
                const result = await syncStructure({
                    prisma,
                    structure: row,
                    anchorCharacterId: anchor.characterId,
                    log,
                });
                syncLine = result.ok
                    ? `✅ 동기화: ${result.itemTypes}종 기록됨`
                    : `⚠️ 동기화 실패: ${result.reason}`;
            }
        }

        return {
            ok: true,
            data: {
                embed: true,
                title: "재고 구조물 등록 완료",
                description:
                    `**${row.displayName}**\n` +
                    `structureId=${row.structureId}\n` +
                    `corporationId=${row.corporationId}\n` +
                    `active=${row.active}\n` +
                    syncLine,
                color: 0x5b9dd9,
                ephemeralReply: true,
            },
        };
    },
};
