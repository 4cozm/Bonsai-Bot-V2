// packages/worker/src/commands/esiApprove.js
import { logger } from "@bonsai/shared";

const log = logger();

/**
 * isMain 정책: 유저당 main 1개. mainCandidate인 등록을 승인하면 isMain=true.
 * 이미 해당 유저에게 main 캐릭터가 있으면 기존 main을 false로 바꾸고 새 캐릭터를 main으로 설정(교체).
 */
export default {
    name: "esi-approve",
    // 슬래시 커맨드 아님. 버튼 interaction으로만 호출됨 (custom_id: esi-approve:{registrationId})
    discord: null,

    /**
     * 승인 버튼 처리: clickerDiscordId === discordUserId일 때만 CONFIRMED + EveCharacter 확정.
     *
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {string} ctx.tenantKey
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const prisma = ctx?.prisma;
        const meta = envelope?.meta ?? {};
        const clickerDiscordId = String(meta.discordUserId ?? "").trim();

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
        if (!clickerDiscordId) {
            return { ok: false, data: { error: "요청자 정보가 없습니다." } };
        }
        if (!prisma) {
            log.warn("[cmd:esi-approve] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }

        const reg = await prisma.esiRegistration.findUnique({
            where: { id: registrationId },
        });
        if (!reg) {
            log.warn("[cmd:esi-approve] 등록 없음 id=" + registrationId);
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
        if (reg.discordUserId !== clickerDiscordId) {
            log.warn(
                `[cmd:esi-approve] 소유자 불일치 registrationId=${registrationId} expected=${reg.discordUserId} clicker=${clickerDiscordId}`
            );
            await prisma.esiRegistration.update({
                where: { id: registrationId },
                data: { status: "REJECTED" },
            });
            return { ok: false, data: { error: "본인만 승인할 수 있습니다." } };
        }

        const isMainCandidate = Boolean(reg.mainCandidate);

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
            log.error("[cmd:esi-approve] transaction 실패", err);
            return { ok: false, data: { error: "저장 중 오류가 발생했습니다." } };
        }

        log.info(
            `[cmd:esi-approve] 승인 완료 registrationId=${registrationId} characterId=${reg.characterId} characterName=${reg.characterName}`
        );

        return {
            ok: true,
            data: {
                embed: true,
                title: "EVE 캐릭터 연동 완료",
                description: `**${reg.characterName}** 캐릭터가 연동되었습니다.${isMainCandidate ? " (메인 캐릭터)" : ""}`,
                footer: `characterId: ${reg.characterId}`,
            },
        };
    },
};
