// packages/worker/src/commands/setStockDivisionRule.js
import { logger } from "@bonsai/shared";

const log = logger();

function parseAdminIds(envValue) {
    return new Set(
        String(envValue ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
    );
}

function parseArgs(rawArgs) {
    try {
        const obj = JSON.parse(String(rawArgs ?? "").trim() || "{}");
        return obj && typeof obj === "object" ? obj : {};
    } catch {
        return {};
    }
}

function formatRule(rule) {
    const scope = rule.containerName
        ? `${rule.division}번 · ${rule.containerName}`
        : `${rule.division}번 전체`;
    return `${rule.tracked ? "✅" : "⛔"} ${scope} — ${rule.displayName}`;
}

export default {
    name: "재고행어설정",
    discord: {
        name: "재고행어설정",
        description: "[관리자 전용] 콥행어(division)·하위 컨테이너별 재고 추적 여부 설정",
        type: 1,
        options: [
            {
                type: 3, // STRING (item_id가 커서 INTEGER 옵션은 클라이언트에서 반올림될 수 있다)
                name: "구조물",
                description: "구조물 item_id (재고구조물등록에 쓴 것과 동일)",
                required: true,
            },
            {
                type: 4, // INTEGER
                name: "행어",
                description: "콥행어 번호 1-7",
                required: true,
            },
            {
                type: 5, // BOOLEAN
                name: "추적",
                description: "이 행어(또는 컨테이너)를 재고 추적 대상에 포함할지",
                required: true,
            },
            {
                type: 3, // STRING
                name: "표시이름",
                description: "프론트에 보여줄 이름 (예: PVP, 드론)",
                required: true,
            },
            {
                type: 3, // STRING
                name: "컨테이너",
                description:
                    "행어 안 이름 붙은 하위 컨테이너 이름(예: 드론). 생략하면 행어 전체에 적용되는 규칙.",
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
        const adminIds = parseAdminIds(process.env.ADMIN_DISCORD_IDS);
        if (!adminIds.has(discordUserId)) {
            log.warn(`[cmd:재고행어설정] 관리자 아님 discordUserId=${discordUserId}`);
            return {
                ok: false,
                data: { error: "이 명령은 관리자만 사용할 수 있습니다.", ephemeralReply: true },
            };
        }

        const prisma = ctx?.prisma;
        if (!prisma) {
            log.warn("[cmd:재고행어설정] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류", ephemeralReply: true } };
        }

        const {
            구조물: structureIdRaw,
            행어: divisionRaw,
            추적: tracked,
            표시이름: displayName,
            컨테이너: containerNameRaw,
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

        const division = Number(divisionRaw);
        if (!Number.isInteger(division) || division < 1 || division > 7) {
            return {
                ok: false,
                data: { error: "행어 번호는 1~7이어야 합니다.", ephemeralReply: true },
            };
        }

        const containerName = String(containerNameRaw ?? "").trim() || null;

        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return {
                ok: false,
                data: {
                    error: "등록되지 않은 구조물입니다. /재고구조물등록을 먼저 실행해주세요.",
                    ephemeralReply: true,
                },
            };
        }

        await prisma.stockDivisionRule.upsert({
            where: { structureId_division_containerName: { structureId, division, containerName } },
            create: { structureId, division, containerName, tracked, displayName },
            update: { tracked, displayName },
        });

        log.info("[cmd:재고행어설정] upsert 완료", {
            structureId: String(structureId),
            division,
            containerName,
            tracked,
        });

        const allRules = await prisma.stockDivisionRule.findMany({
            where: { structureId },
            orderBy: [{ division: "asc" }, { containerName: "asc" }],
        });

        return {
            ok: true,
            data: {
                embed: true,
                title: "행어 추적 규칙 설정 완료",
                description:
                    `**${structure.displayName}**\n\n` +
                    (allRules.length > 0
                        ? allRules.map(formatRule).join("\n")
                        : "설정된 규칙이 없습니다."),
                color: 0x5b9dd9,
                ephemeralReply: true,
            },
        };
    },
};
