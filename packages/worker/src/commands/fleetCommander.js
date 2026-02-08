// packages/worker/src/commands/fleetCommander.js
import { logger } from "@bonsai/shared";

const log = logger();

export default {
    name: "함대장변경",
    discord: {
        name: "함대장변경",
        description: "함대장을 변경합니다",
        type: 1,
        options: [
            {
                name: "대상캐릭터",
                description: "변경할 대상 캐릭터 (미입력 시 대표 캐릭터)",
                type: 3, // STRING
                required: false,
                autocomplete: true,
            },
        ],
    },

    /**
     * Autocomplete 핸들러 — Worker autocompleteConsumer에서 호출.
     * discordUserId 소유 캐릭터 목록을 반환한다.
     *
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {object} params
     * @param {string} params.discordUserId
     * @param {string} params.focusedValue - 사용자가 입력 중인 문자열
     * @returns {Promise<Array<{name: string, value: string}>>}
     */
    async autocomplete(ctx, { discordUserId, focusedValue }) {
        const prisma = ctx.prisma;
        if (!prisma) return [];

        const where = { discordUserId };
        if (focusedValue) {
            where.characterName = { contains: focusedValue };
        }

        const rows = await prisma.eveCharacter.findMany({
            where,
            select: { characterName: true, characterId: true, isMain: true },
            orderBy: { characterName: "asc" },
            take: 25,
        });

        return rows.map((r) => ({
            name: r.isMain ? `⭐ ${r.characterName}` : r.characterName,
            value: String(r.characterId),
        }));
    },

    /**
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {any} envelope
     * @returns {Promise<{ok: boolean, data: any}>}
     */
    async execute(ctx, envelope) {
        const prisma = ctx?.prisma;
        if (!prisma) {
            return { ok: false, data: { error: "DB 연결이 없습니다." } };
        }

        const meta = envelope?.meta ?? {};
        const discordUserId = String(meta.discordUserId ?? "").trim();
        if (!discordUserId) {
            return { ok: false, data: { error: "discordUserId가 비어있습니다." } };
        }

        // args 파싱
        let args = {};
        try {
            const raw = envelope?.args;
            if (typeof raw === "string" && raw.trim()) args = JSON.parse(raw);
            else if (raw && typeof raw === "object") args = raw;
        } catch {
            // ignore
        }

        let targetCharacterId = String(args["대상캐릭터"] ?? "").trim();

        // 대상캐릭터 미입력 → 대표 캐릭터(isMain)를 기본값으로 사용
        if (!targetCharacterId) {
            const mainChar = await prisma.eveCharacter.findFirst({
                where: { discordUserId, isMain: true },
                select: { characterId: true, characterName: true },
            });

            if (!mainChar) {
                return {
                    ok: false,
                    data: {
                        error:
                            "대상 캐릭터를 지정하지 않았고, 대표 캐릭터도 설정되어 있지 않습니다. " +
                            "캐릭터를 직접 선택하거나 대표 캐릭터를 먼저 등록해주세요.",
                    },
                };
            }

            targetCharacterId = String(mainChar.characterId);
            log.info(
                `[함대장변경] 대표 캐릭터 기본값 사용 discordUserId=${discordUserId} ` +
                    `characterId=${targetCharacterId} name=${mainChar.characterName}`
            );
        }

        // TODO: 실제 함대장 변경 로직 구현
        return { ok: true, data: { message: "준비 중인 기능입니다." } };
    },
};
