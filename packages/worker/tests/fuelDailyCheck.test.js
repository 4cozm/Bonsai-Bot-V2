// packages/worker/tests/fuelDailyCheck.test.js
import { describe, expect, jest, test } from "@jest/globals";

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

await jest.unstable_mockModule("../src/esi/getCorporationStructures.js", () => ({
    getCorporationStructures: mockGetCorporationStructures,
}));

const { default: fuelDailyCheck } = await import("../src/commands/fuelDailyCheck.js");

const prisma = {};
const baseCtx = { prisma, tenantKey: "CAT" };
const baseEnvelope = {
    meta: { channelId: "ch1", guildId: "g1" },
};

function structureWithDays(remainingDays) {
    const d = new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000);
    return {
        name: "Test Structure",
        fuel_expires: d.toISOString(),
        type_id: 35832,
    };
}

describe("worker/commands 연료-일일체크 (fuelDailyCheck)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockParseAnchorCharIds.mockReturnValue([]);
    });

    test("prisma 없음 → ok:false, data.error 시스템 설정 오류", async () => {
        const ctx = { prisma: null, tenantKey: "CAT" };
        const out = await fuelDailyCheck.execute(ctx, baseEnvelope);

        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("시스템 설정 오류");
        expect(mockPostDiscordWebhook).not.toHaveBeenCalled();
    });

    test("EVE_ANCHOR_CHARIDS 비어있음 → ok:false, 웹후크 URL 있으면 postDiscordWebhook 1회", async () => {
        mockParseAnchorCharIds.mockReturnValue([]);
        process.env.DISCORD_ALERT_WEBHOOK_URL = "https://example.com/webhook";

        const out = await fuelDailyCheck.execute(baseCtx, baseEnvelope);

        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("EVE_ANCHOR_CHARIDS");
        expect(mockPostDiscordWebhook).toHaveBeenCalledTimes(1);
        expect(mockPostDiscordWebhook).toHaveBeenCalledWith({
            url: "https://example.com/webhook",
            payload: {
                content: expect.stringContaining("연료 조회용 캐릭터 설정이 없습니다"),
            },
        });

        delete process.env.DISCORD_ALERT_WEBHOOK_URL;
    });

    test("구조물 0건 → ok:false, 웹후크 1회 (스트럭쳐 정보 없음)", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([]);
        process.env.DISCORD_ALERT_WEBHOOK_URL = "https://example.com/webhook";

        const out = await fuelDailyCheck.execute(baseCtx, baseEnvelope);

        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("스트럭쳐 정보가 없어요");
        expect(mockPostDiscordWebhook).toHaveBeenCalledTimes(1);
        expect(mockPostDiscordWebhook).toHaveBeenCalledWith({
            url: "https://example.com/webhook",
            payload: {
                content: expect.stringContaining("스트럭쳐 연료량 자동 검사중"),
            },
        });

        delete process.env.DISCORD_ALERT_WEBHOOK_URL;
    });

    test("전부 안전(remainingDays > 30) → ok:true, meta.broadcastToChannel, 웹후크 0회", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([structureWithDays(60)]);

        const out = await fuelDailyCheck.execute(baseCtx, baseEnvelope);

        expect(out.ok).toBe(true);
        expect(out.data.message).toContain("연료 검사 완료");
        expect(out.data.message).toContain("안전 범위");
        expect(out.meta).toEqual({
            broadcastToChannel: true,
            channelId: "ch1",
            guildId: "g1",
        });
        expect(mockPostDiscordWebhook).not.toHaveBeenCalled();
    });

    test("부족 1건 이상 → ok:true, 웹후크 1회, payload.content에 건물명·일수 포함", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([structureWithDays(10)]);
        process.env.DISCORD_ALERT_WEBHOOK_URL = "https://example.com/webhook";

        const out = await fuelDailyCheck.execute(baseCtx, baseEnvelope);

        expect(out.ok).toBe(true);
        expect(out.data.alerted).toBe(1);
        expect(out.data.structures).toHaveLength(1);
        expect(mockPostDiscordWebhook).toHaveBeenCalledTimes(1);
        const [call] = mockPostDiscordWebhook.mock.calls;
        expect(call[0].payload.content).toMatch(/연료가 10일 남았습니다/);
        expect(call[0].payload.content).toContain("Test Structure");

        delete process.env.DISCORD_ALERT_WEBHOOK_URL;
    });
});
