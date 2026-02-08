// Worker integration (command-level): 연료 — 고정 Mock(불변성: fuel_expires ISO 등)
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { buildDiscordReplyPayload } from "../../../master/src/discord/buildDiscordReplyPayload.js";

const FIXED_FUEL_EXPIRES = "2026-12-31T00:00:00Z"; // 고정 ISO
const mockGetAccessTokenForCharacter = jest.fn();
const mockGetCorporationStructures = jest.fn();
const mockParseAnchorCharIds = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    parseAnchorCharIds: mockParseAnchorCharIds,
    getAccessTokenForCharacter: mockGetAccessTokenForCharacter,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

await jest.unstable_mockModule("../../src/esi/getCorporationStructures.js", () => ({
    getCorporationStructures: mockGetCorporationStructures,
}));

const fuelCmd = (await import("../../src/commands/fuel.js")).default;

function fixedStructure() {
    return {
        name: "Test Citadel",
        fuel_expires: FIXED_FUEL_EXPIRES,
        type_id: 35832,
        structure_id: 99,
        system_id: 30000142,
    };
}

describe("e2e / 연료 (fuel)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("mock-token");
        mockGetCorporationStructures.mockResolvedValue([fixedStructure()]);
    });

    test("Master envelope 형식 → ok:true, data.embed·embeds[0].fields 3개·ephemeralReply", async () => {
        const ctx = { prisma: {}, redis: null, tenantKey: "CAT" };
        const envelope = {
            id: "env-1",
            cmd: "연료",
            meta: { discordUserId: "u1", guildId: "g1", channelId: "ch1" },
            args: "{}",
        };

        const result = await fuelCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.data.embed).toBe(true);
        expect(result.data.embeds).toHaveLength(1);
        expect(result.data.embeds[0].fields).toHaveLength(3);
        expect(result.data.ephemeralReply).toBe(true);
        const payload = buildDiscordReplyPayload(result.data);
        expect(payload.embeds?.length > 0 || payload.content).toBeTruthy();
    });

    test("args.ephemeral false → data.ephemeralReply false", async () => {
        const ctx = { prisma: {}, redis: null, tenantKey: "CAT" };
        const envelope = {
            id: "env-2",
            cmd: "연료",
            meta: { discordUserId: "u1", guildId: "g1", channelId: "ch1" },
            args: '{"ephemeral":false}',
        };

        const result = await fuelCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.data.ephemeralReply).toBe(false);
    });
});
