// packages/worker/tests/fleetCommander.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockGetAccessTokenForCharacter = jest.fn();
const mockGetCharacterFleet = jest.fn();
const mockGetFleetMembers = jest.fn();
const mockSetFleetMemberRole = jest.fn();
const mockResolveNames = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    getAccessTokenForCharacter: mockGetAccessTokenForCharacter,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

await jest.unstable_mockModule("../src/esi/fleet.js", () => ({
    getCharacterFleet: mockGetCharacterFleet,
    getFleetMembers: mockGetFleetMembers,
    setFleetMemberRole: mockSetFleetMemberRole,
    resolveNames: mockResolveNames,
}));

const { default: fleetCommander } = await import("../src/commands/fleetCommander.js");

const discordUserId = "discord-u-1";
const channelId = "ch1";
const guildId = "g1";

function baseEnvelope(overrides = {}) {
    return {
        meta: { discordUserId, channelId, guildId },
        args: "{}",
        ...overrides,
    };
}

function basePrisma() {
    return {
        eveCharacter: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
        },
    };
}

describe("worker/commands 함대장변경 (fleetCommander) execute 에러 경로", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("prisma 없음 → ok:false, data.error === 'DB 연결이 없습니다.'", async () => {
        const ctx = { prisma: null };
        const out = await fleetCommander.execute(ctx, baseEnvelope());
        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("DB 연결이 없습니다.");
    });

    test("meta.discordUserId 없음/빈 문자열 → ok:false, data.error에 discordUserId", async () => {
        const prisma = basePrisma();
        const ctx = { prisma };
        const out = await fleetCommander.execute(ctx, baseEnvelope({ meta: {} }));
        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("discordUserId");
    });

    test("getCharacterFleet null(플릿 미참가) → ok:false, 플릿에 참가하고 있지 않습니다", async () => {
        const prisma = basePrisma();
        prisma.eveCharacter.findFirst.mockResolvedValue({
            characterId: 100n,
            characterName: "MyChar",
        });
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCharacterFleet.mockResolvedValue(null);

        const ctx = { prisma };
        const out = await fleetCommander.execute(ctx, baseEnvelope());

        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("플릿에 참가하고 있지 않습니다");
    });

    test("fleet_boss_id 없음 → ok:false, Boss를 식별할 수 없습니다", async () => {
        const prisma = basePrisma();
        prisma.eveCharacter.findFirst.mockResolvedValue({
            characterId: 100n,
            characterName: "MyChar",
        });
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCharacterFleet.mockResolvedValue({
            fleet_id: 999,
            role: "squad_member",
            squad_id: 1,
            wing_id: 2,
            fleet_boss_id: null,
        });

        const ctx = { prisma };
        const out = await fleetCommander.execute(ctx, baseEnvelope());

        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("Boss를 식별할 수 없습니다");
    });

    test("boss DB 미가입(accessToken/refreshToken null) → ok:false, ESI에 가입되지 않아", async () => {
        const prisma = basePrisma();
        prisma.eveCharacter.findFirst.mockResolvedValue({
            characterId: 100n,
            characterName: "MyChar",
        });
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCharacterFleet.mockResolvedValue({
            fleet_id: 999,
            fleet_boss_id: 200,
            squad_id: 1,
            wing_id: 2,
        });
        mockResolveNames.mockResolvedValue([{ id: 200, name: "BossName" }]);
        prisma.eveCharacter.findUnique.mockResolvedValue(null);

        const ctx = { prisma };
        const out = await fleetCommander.execute(ctx, baseEnvelope());

        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("ESI에 가입되지 않아");
    });

    test("정상 경로 → ok:true, data.embed, meta.broadcastToChannel, footer에 discordUserId", async () => {
        const prisma = basePrisma();
        prisma.eveCharacter.findFirst
            .mockResolvedValueOnce({
                characterId: 100n,
                characterName: "MyChar",
            })
            .mockResolvedValueOnce(null);
        prisma.eveCharacter.findUnique.mockResolvedValue({
            characterId: 200n,
            characterName: "BossChar",
            accessToken: "boss-token",
            refreshToken: "boss-refresh",
        });
        mockGetAccessTokenForCharacter
            .mockResolvedValueOnce("requester-token")
            .mockResolvedValueOnce("boss-token");
        mockGetCharacterFleet.mockResolvedValue({
            fleet_id: 999,
            fleet_boss_id: 200,
            squad_id: 1,
            wing_id: 2,
        });
        mockResolveNames.mockResolvedValue([{ id: 200, name: "BossName" }]);
        mockGetFleetMembers.mockResolvedValue([]);
        mockSetFleetMemberRole.mockResolvedValue({ ok: true, status: 204 });

        const ctx = { prisma };
        const out = await fleetCommander.execute(ctx, baseEnvelope());

        expect(out.ok).toBe(true);
        expect(out.data.embed).toBe(true);
        expect(out.data.title).toContain("함대장 변경 완료");
        expect(out.meta).toEqual({
            broadcastToChannel: true,
            channelId: "ch1",
            guildId: "g1",
        });
        expect(out.data.footer).toContain(`<@${discordUserId}>`);
    });
});

describe("worker/commands 함대장변경 (fleetCommander) autocomplete", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("ctx.prisma 없음 → []", async () => {
        const choices = await fleetCommander.autocomplete(
            { prisma: null },
            { discordUserId: "u1", focusedValue: "" }
        );
        expect(choices).toEqual([]);
    });

    test("findMany 결과 → name/value 형식, isMain이면 name에 ⭐", async () => {
        const prisma = basePrisma();
        prisma.eveCharacter.findMany.mockResolvedValue([
            { characterName: "A", characterId: 1n, isMain: false },
            { characterName: "B", characterId: 2n, isMain: true },
        ]);

        const choices = await fleetCommander.autocomplete(
            { prisma },
            { discordUserId: "u1", focusedValue: "" }
        );

        expect(choices).toHaveLength(2);
        expect(choices[0]).toEqual({ name: "A", value: "1" });
        expect(choices[1]).toEqual({ name: "⭐ B", value: "2" });
    });
});

describe("worker/commands 함대장변경 (fleetCommander) execute 권장 시나리오", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("이미 fleet_commander인 경우 → ok:true, 이미 Fleet Commander 문구", async () => {
        const prisma = basePrisma();
        prisma.eveCharacter.findFirst.mockResolvedValue({
            characterId: 100n,
            characterName: "MyChar",
        });
        prisma.eveCharacter.findUnique.mockResolvedValue({
            characterId: 200n,
            characterName: "BossChar",
            accessToken: "boss-token",
            refreshToken: "boss-refresh",
        });
        mockGetAccessTokenForCharacter
            .mockResolvedValueOnce("requester-token")
            .mockResolvedValueOnce("boss-token");
        mockGetCharacterFleet.mockResolvedValue({
            fleet_id: 999,
            fleet_boss_id: 200,
            squad_id: 1,
            wing_id: 2,
        });
        mockResolveNames.mockResolvedValue([{ id: 200, name: "BossName" }]);
        mockGetFleetMembers.mockResolvedValue([
            { character_id: 100, role: "fleet_commander", role_name: "Fleet Commander" },
        ]);

        const ctx = { prisma };
        const out = await fleetCommander.execute(
            ctx,
            baseEnvelope({ args: '{"대상캐릭터":"100"}' })
        );

        expect(out.ok).toBe(true);
        expect(out.data.description).toContain("이미 Fleet Commander");
        expect(mockSetFleetMemberRole).not.toHaveBeenCalled();
    });

    test("대표 캐릭터 없음 + args 비움 → ok:false, 대표 캐릭터 관련 메시지", async () => {
        const prisma = basePrisma();
        prisma.eveCharacter.findFirst.mockResolvedValue(null);

        const ctx = { prisma };
        const out = await fleetCommander.execute(ctx, baseEnvelope({ args: "{}" }));

        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("대표 캐릭터");
    });

    test("현재 FC 강등 후 승격 → setFleetMemberRole demote 1회, promote 1회", async () => {
        const prisma = basePrisma();
        prisma.eveCharacter.findFirst.mockResolvedValue({
            characterId: 100n,
            characterName: "MyChar",
        });
        prisma.eveCharacter.findUnique.mockResolvedValue({
            characterId: 200n,
            characterName: "BossChar",
            accessToken: "boss-token",
            refreshToken: "boss-refresh",
        });
        mockGetAccessTokenForCharacter
            .mockResolvedValueOnce("requester-token")
            .mockResolvedValueOnce("boss-token");
        mockGetCharacterFleet.mockResolvedValue({
            fleet_id: 999,
            fleet_boss_id: 200,
            squad_id: 1,
            wing_id: 2,
        });
        mockResolveNames
            .mockResolvedValueOnce([{ id: 200, name: "BossName" }])
            .mockResolvedValueOnce([{ id: 99, name: "OldFC" }]);
        mockGetFleetMembers.mockResolvedValue([
            { character_id: 99, role: "fleet_commander", role_name: "Fleet Commander" },
            { character_id: 100, role: "squad_member", role_name: "Squad Member" },
        ]);
        mockSetFleetMemberRole.mockResolvedValue({ ok: true, status: 204 });

        const ctx = { prisma };
        const out = await fleetCommander.execute(ctx, baseEnvelope());

        expect(out.ok).toBe(true);
        expect(mockSetFleetMemberRole).toHaveBeenCalledTimes(2);
        expect(mockSetFleetMemberRole).toHaveBeenNthCalledWith(
            1,
            "boss-token",
            999,
            99,
            expect.objectContaining({ role: "squad_member", squad_id: 1, wing_id: 2 })
        );
        expect(mockSetFleetMemberRole).toHaveBeenNthCalledWith(2, "boss-token", 999, "100", {
            role: "fleet_commander",
        });
    });
});
