// Worker integration (command-level): 연료-일일체크 — meta.broadcastToChannel·channelId·guildId 검증
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { buildDiscordReplyPayload } from "../../../master/src/discord/buildDiscordReplyPayload.js";

const FIXED_FUEL_EXPIRES_SAFE = "2026-12-31T00:00:00Z"; // 30일 이상 남음
const mockPostDiscordWebhook = jest.fn().mockResolvedValue(undefined);
const mockGetAccessTokenForCharacter = jest.fn();
const mockGetCorporationStructures = jest.fn();
const mockParseAnchorCharIds = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    parseAnchorCharIds: mockParseAnchorCharIds,
    getAccessTokenForCharacter: mockGetAccessTokenForCharacter,
    postDiscordWebhook: mockPostDiscordWebhook,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

await jest.unstable_mockModule("../../src/esi/getCorporationStructures.js", () => ({
    getCorporationStructures: mockGetCorporationStructures,
}));

const fuelDailyCheckCmd = (await import("../../src/commands/fuelDailyCheck.js")).default;

function structureWithFixedExpires(iso) {
    return {
        name: "Test Structure",
        fuel_expires: iso,
        type_id: 35832,
    };
}

describe("e2e / 연료-일일체크 (fuelDailyCheck)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
    });

    test("전부 안전 → ok:true, meta.broadcastToChannel true, meta.channelId·guildId 존재", async () => {
        mockGetCorporationStructures.mockResolvedValue([
            structureWithFixedExpires(FIXED_FUEL_EXPIRES_SAFE),
        ]);
        const ctx = { prisma: {}, tenantKey: "CAT" };
        const envelope = {
            id: "env-1",
            cmd: "연료-일일체크",
            meta: { channelId: "ch-123", guildId: "g-456" },
            args: "{}",
        };

        const result = await fuelDailyCheckCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.meta).toEqual({
            broadcastToChannel: true,
            channelId: "ch-123",
            guildId: "g-456",
        });
        const payload = buildDiscordReplyPayload(result.data);
        expect(payload.content || payload.embeds?.length > 0).toBeTruthy();
    });

    test("부족 1건 이상 → ok:true, TENANT_ALERT_WEBHOOK_URL로 임베드 웹후크 1회 호출", async () => {
        const lowDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
        mockGetCorporationStructures.mockResolvedValue([structureWithFixedExpires(lowDays)]);
        const origEnv = process.env.TENANT_ALERT_WEBHOOK_URL;
        process.env.TENANT_ALERT_WEBHOOK_URL = "https://example.com/tenant-webhook";
        const ctx = { prisma: {}, tenantKey: "CAT" };
        const envelope = {
            id: "env-2",
            cmd: "연료-일일체크",
            meta: { channelId: "ch1", guildId: "g1" },
            args: "{}",
        };

        const result = await fuelDailyCheckCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(mockPostDiscordWebhook).toHaveBeenCalledTimes(1);
        const [call] = mockPostDiscordWebhook.mock.calls;
        expect(call[0].url).toBe("https://example.com/tenant-webhook");
        expect(call[0].payload.embeds).toBeDefined();
        expect(call[0].payload.embeds[0].title).toContain("연료 부족");
        if (origEnv !== undefined) process.env.TENANT_ALERT_WEBHOOK_URL = origEnv;
        else delete process.env.TENANT_ALERT_WEBHOOK_URL;
    });
});
