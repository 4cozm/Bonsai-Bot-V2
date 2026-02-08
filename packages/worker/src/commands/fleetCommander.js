// packages/worker/src/commands/fleetCommander.js
//
// /함대장변경 — 요청자 캐릭터를 fleet_commander로 승격시키는 명령어.
//
// 필요 ESI scope (유저 등록 시 반드시 포함해야 함):
//   - esi-fleets.read_fleet.v1   (GET /characters/{id}/fleet, GET /fleets/{id}/members)
//   - esi-fleets.write_fleet.v1  (PUT /fleets/{id}/members/{id})
//
import { getAccessTokenForCharacter, logger } from "@bonsai/shared";
import { getCharacterFleet, resolveNames, setFleetMemberRole } from "../esi/fleet.js";

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
     * /함대장변경 실행 로직:
     *
     * 1. 요청자 캐릭터ID 확보 (args 또는 대표 캐릭터)
     * 2. 요청자 토큰으로 GET /characters/{me}/fleet/ → fleet_id 확보
     * 3. 요청자 토큰으로 GET /fleets/{fleet_id}/members/ → boss 식별
     * 4. boss가 봇 DB에 있는지 확인 (없으면 "ESI 미가입" 종료)
     * 5. boss 토큰으로 PUT /fleets/{fleet_id}/members/{me}/ → fleet_commander 승격
     * 6. 결과 메시지 반환
     *
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

        // ── args 파싱 ──
        let args = {};
        try {
            const raw = envelope?.args;
            if (typeof raw === "string" && raw.trim()) args = JSON.parse(raw);
            else if (raw && typeof raw === "object") args = raw;
        } catch {
            // ignore
        }

        // ── 1단계: 요청자 캐릭터ID 확보 ──
        let targetCharacterId = String(args["대상캐릭터"] ?? "").trim();
        let targetCharacterName = "";

        if (!targetCharacterId) {
            // 미입력 → 대표 캐릭터(isMain) 기본값
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
            targetCharacterName = mainChar.characterName;
            log.debug(
                `[함대장변경] 대표 캐릭터 기본값 사용 discordUserId=${discordUserId} ` +
                    `characterId=${targetCharacterId} name=${targetCharacterName}`
            );
        } else {
            // autocomplete에서 선택한 값(characterId)으로 이름도 조회
            const selectedChar = await prisma.eveCharacter.findFirst({
                where: { characterId: BigInt(targetCharacterId) },
                select: { characterName: true },
            });
            targetCharacterName = selectedChar?.characterName ?? targetCharacterId;
        }

        log.debug(`[함대장변경] 1단계 완료: 요청자=${targetCharacterName}(${targetCharacterId})`);

        // ── 2단계: 요청자 토큰 확보 + fleet 조회 ──
        const requesterToken = await getAccessTokenForCharacter(prisma, targetCharacterId);
        if (!requesterToken) {
            return {
                ok: false,
                data: {
                    error: `캐릭터 "${targetCharacterName}"의 ESI 토큰을 가져올 수 없습니다. ESI 재등록이 필요할 수 있습니다.`,
                },
            };
        }
        log.debug(`[함대장변경] 2단계: 요청자 토큰 확보 완료`);

        const fleetInfo = await getCharacterFleet(requesterToken, targetCharacterId);
        if (!fleetInfo || !fleetInfo.fleet_id) {
            return {
                ok: false,
                data: {
                    error: `캐릭터 "${targetCharacterName}"은(는) 현재 플릿에 참가하고 있지 않습니다.`,
                },
            };
        }

        const fleetId = fleetInfo.fleet_id;
        const bossCharacterId = fleetInfo.fleet_boss_id;
        log.debug(
            `[함대장변경] 2단계 완료: fleet_id=${fleetId} role=${fleetInfo.role} fleet_boss_id=${bossCharacterId}`
        );

        // ── 3단계: boss 식별 (fleet_boss_id로 직접 확보) ──
        if (!bossCharacterId) {
            return {
                ok: false,
                data: { error: "플릿에서 Boss를 식별할 수 없습니다 (fleet_boss_id 없음)." },
            };
        }

        log.debug(`[함대장변경] 3단계: boss characterId=${bossCharacterId}`);

        // boss 이름 조회 (메시지용)
        let bossName = String(bossCharacterId);
        const names = await resolveNames([bossCharacterId]);
        if (names.length > 0) {
            bossName = names[0].name ?? bossName;
        }
        log.debug(`[함대장변경] boss 이름 조회 완료: ${bossName}`);

        // 요청자가 이미 boss인 경우
        if (String(bossCharacterId) === String(targetCharacterId)) {
            return {
                ok: true,
                data: {
                    embed: true,
                    title: "함대장 변경",
                    description: `**${targetCharacterName}** 은(는) 이미 함대장(Boss)입니다.`,
                    color: 0xf1c40f, // 노랑 — 경고/알림
                    timestamp: false,
                },
            };
        }

        // ── 4단계: boss가 봇 DB에 있는지 확인 ──
        const bossRow = await prisma.eveCharacter.findUnique({
            where: { characterId: BigInt(bossCharacterId) },
            select: {
                characterId: true,
                characterName: true,
                accessToken: true,
                refreshToken: true,
            },
        });

        if (!bossRow || bossRow.accessToken == null || bossRow.refreshToken == null) {
            return {
                ok: false,
                data: {
                    error:
                        `현재 함대장 "${bossName}" (ID: ${bossCharacterId}) 유저는 봇 ESI에 가입되지 않아 ` +
                        `컨트롤이 불가합니다. 해당 유저가 봇에 ESI 등록을 해야 합니다.`,
                },
            };
        }

        log.debug(`[함대장변경] 4단계 완료: boss "${bossName}" DB 확인 OK`);

        // ── 5단계: boss 토큰으로 요청자를 fleet_commander로 승격 ──
        const bossToken = await getAccessTokenForCharacter(prisma, bossCharacterId);
        if (!bossToken) {
            return {
                ok: false,
                data: {
                    error:
                        `현재 함대장 "${bossName}"의 ESI 토큰을 갱신할 수 없습니다. ` +
                        `해당 유저의 ESI 재등록이 필요할 수 있습니다.`,
                },
            };
        }

        log.debug(`[함대장변경] 5단계: boss 토큰 확보 완료, PUT 시작`);

        const putResult = await setFleetMemberRole(bossToken, fleetId, targetCharacterId, {
            role: "fleet_commander",
        });

        log.debug(
            `[함대장변경] 5단계 PUT 결과: ok=${putResult.ok} status=${putResult.status}` +
                (putResult.error ? ` error=${putResult.error}` : "")
        );

        if (!putResult.ok) {
            return {
                ok: false,
                data: {
                    error:
                        `함대장 변경 ESI 요청이 실패했습니다 (HTTP ${putResult.status}). ` +
                        `${putResult.error ?? ""}`,
                },
            };
        }

        // ── 6단계: 성공 ──
        log.debug(`[함대장변경] 6단계: 성공!`);

        return {
            ok: true,
            data: {
                embed: true,
                title: "✅ 함대장 변경 완료",
                description: `**${targetCharacterName}**을(를) 함대장으로 변경했습니다.`,
                fields: [
                    { name: "새 함대장", value: targetCharacterName, inline: true },
                    { name: "이전 함대장", value: bossName, inline: true },
                    { name: "Fleet ID", value: String(fleetId), inline: true },
                ],
                color: 0x2ecc71, // 초록 — 성공
                footer: `요청자: <@${discordUserId}>`,
            },
        };
    },
};
