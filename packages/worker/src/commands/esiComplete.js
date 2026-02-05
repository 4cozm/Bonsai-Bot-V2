// packages/worker/src/commands/esiComplete.js
import { logger } from "@bonsai/shared";

const log = logger();

/**
 * 콜백 후 자동 완료: EsiRegistration 확정 + EveCharacter 등록.
 * 콜백 후 자동 확정. EveCharacter upsert + EsiRegistration CONFIRMED. 소유자는 등록의 discordUserId로 간주.
 * 결과는 채널 브로드캐스트용으로 반환(meta.broadcastToChannel, meta.channelId).
 */
export default {
    name: "esi-complete",
    discord: null,

    /**
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {string} ctx.tenantKey
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any, meta?: object}>}
     */
    async execute(ctx, envelope) {
        const prisma = ctx?.prisma;
        const meta = envelope?.meta ?? {};
        const channelId = String(meta.channelId ?? "").trim();

        let args = envelope?.args ?? "";
        if (typeof args === "string") {
            try {
                args = JSON.parse(args);
            } catch {
                args = {};
            }
        }
        const registrationId = String(args?.registrationId ?? "").trim();

        if (!registrationId) {
            return { ok: false, data: { error: "등록 ID가 없습니다." } };
        }
        if (!channelId) {
            return { ok: false, data: { error: "채널 정보가 없습니다." } };
        }
        if (!prisma) {
            log.warn("[cmd:esi-complete] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }

        const reg = await prisma.esiRegistration.findUnique({
            where: { id: registrationId },
        });
        if (!reg) {
            log.warn("[cmd:esi-complete] 등록 없음 id=" + registrationId);
            return { ok: false, data: { error: "해당 등록을 찾을 수 없거나 만료되었습니다." } };
        }
        if (reg.status !== "PENDING") {
            return { ok: false, data: { error: "이미 처리된 요청입니다." } };
        }
        if (reg.characterId == null || reg.characterName == null) {
            return {
                ok: false,
                data: {
                    error: "EVE 캐릭터 정보가 아직 반영되지 않았습니다. 잠시 후 다시 시도해 주세요.",
                },
            };
        }

        const isMainCandidate = Boolean(reg.mainCandidate);

        const existedBefore = await prisma.eveCharacter.findUnique({
            where: { characterId: reg.characterId },
        });
        const isReLink = existedBefore != null;

        try {
            await prisma.$transaction(async (tx) => {
                if (isMainCandidate) {
                    const existingMain = await tx.eveCharacter.findFirst({
                        where: { discordUserId: reg.discordUserId, isMain: true },
                    });
                    if (existingMain) {
                        await tx.eveCharacter.update({
                            where: { id: existingMain.id },
                            data: { isMain: false },
                        });
                    }
                }
                await tx.eveCharacter.upsert({
                    where: { characterId: reg.characterId },
                    create: {
                        discordUserId: reg.discordUserId,
                        characterId: reg.characterId,
                        characterName: reg.characterName,
                        isMain: isMainCandidate,
                    },
                    update: {
                        characterName: reg.characterName,
                        ...(isMainCandidate ? { isMain: true } : {}),
                    },
                });
                await tx.esiRegistration.update({
                    where: { id: registrationId },
                    data: { status: "CONFIRMED" },
                });
            });
        } catch (err) {
            log.error("[cmd:esi-complete] transaction 실패", err);
            return { ok: false, data: { error: "저장 중 오류가 발생했습니다." } };
        }

        const discordUserId = reg.discordUserId;
        const newChar = {
            characterId: reg.characterId,
            characterName: reg.characterName,
            isMain: isMainCandidate,
        };

        const allChars = await prisma.eveCharacter.findMany({
            where: { discordUserId },
            orderBy: [{ isMain: "desc" }, { characterName: "asc" }],
        });
        const existingNames = allChars
            .filter((c) => String(c.characterId) !== String(reg.characterId))
            .map((c) => (c.isMain ? `**${c.characterName}** (메인)` : c.characterName));
        const processedCharLabel = newChar.isMain
            ? `**${newChar.characterName}** (메인)`
            : newChar.characterName;

        const processedFieldName = isReLink ? "재연동(정보 갱신)된 캐릭터" : "새로 추가된 캐릭터";

        const fields = [
            { name: "디스코드 계정", value: `<@${discordUserId}>`, inline: false },
            {
                name: "기존 연동 캐릭터",
                value: existingNames.length > 0 ? existingNames.join(", ") : "없음",
                inline: false,
            },
            { name: processedFieldName, value: processedCharLabel, inline: false },
        ];

        const description = isReLink
            ? "이미 연동된 캐릭터 정보를 갱신했습니다."
            : "캐릭터가 등록되었습니다.";

        log.info(
            `[cmd:esi-complete] 완료 registrationId=${registrationId} characterId=${reg.characterId} characterName=${reg.characterName} isReLink=${isReLink}`
        );

        return {
            ok: true,
            data: {
                embed: true,
                title: "EVE ESI 연동 완료",
                description,
                fields,
                footer: `characterId: ${reg.characterId}`,
            },
            meta: {
                broadcastToChannel: true,
                channelId,
                guildId: String(meta.guildId ?? "").trim(),
            },
        };
    },
};
