// packages/worker/src/commands/esiList.js
import { logger } from "@bonsai/shared";

const log = logger();

/**
 * 현재 디스코드 유저가 연동한 EVE 캐릭터 목록을 조회해 임베드로 반환.
 */
export default {
    name: "캐릭터목록",
    discord: {
        name: "캐릭터목록",
        description: "내가 연동한 EVE 캐릭터 목록 보기",
        type: 1,
        options: [],
    },

    /**
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {string} ctx.tenantKey
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const prisma = ctx?.prisma;
        const meta = envelope?.meta ?? {};
        const discordUserId = String(meta.discordUserId ?? "").trim();

        if (!discordUserId) {
            return { ok: false, data: { error: "요청자 정보가 없습니다." } };
        }
        if (!prisma) {
            log.warn("[cmd:캐릭터목록] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }

        const chars = await prisma.eveCharacter.findMany({
            where: { discordUserId },
            orderBy: [{ isMain: "desc" }, { characterName: "asc" }],
        });

        const lines =
            chars.length > 0
                ? chars.map((c) => (c.isMain ? `**${c.characterName}** (메인)` : c.characterName))
                : ["연동된 캐릭터가 없습니다."];
        const value = chars.length > 0 ? lines.join("\n") : lines[0];

        log.info(`[cmd:캐릭터목록] 조회 discordUserId=${discordUserId} count=${chars.length}`);

        return {
            ok: true,
            data: {
                embed: true,
                title: "연동 EVE 캐릭터 목록",
                description: `<@${discordUserId}> 님의 연동 캐릭터입니다.`,
                fields: [{ name: "캐릭터", value, inline: false }],
                footer: `총 ${chars.length}명`,
                color: 0x9b59b6,
            },
        };
    },
};
