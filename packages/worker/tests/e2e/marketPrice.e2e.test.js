// Worker integration (command-level): 시세 — 고정 Mock(불변성), ok/data.embed·ephemeralReply 검증
import { describe, expect, jest, test } from "@jest/globals";
import { buildDiscordReplyPayload } from "../../../master/src/discord/buildDiscordReplyPayload.js";

const FIXED_FETCHED_AT = 1700000000; // 고정 초 (테스트 불변성)
const FIXED_SELL_MIN = 16200;
const FIXED_BUY_MAX = 9304;

const mockGetMarketPrice = jest.fn().mockResolvedValue({
    sellMin: FIXED_SELL_MIN,
    buyMax: FIXED_BUY_MAX,
    fetchedAt: FIXED_FETCHED_AT,
    stale: false,
    capped: false,
});

await jest.unstable_mockModule("../../src/market/esiMarketCache.js", () => ({
    getMarketPrice: mockGetMarketPrice,
}));

const marketPriceCmd = (await import("../../src/commands/marketPrice.js")).default;

describe("e2e / 시세 (marketPrice)", () => {
    test("type mineral, hub jita → ok:true, data.embed·embeds[0].fields 3개·ephemeralReply", async () => {
        const ctx = { redis: {}, tenantKey: "global" };
        const envelope = {
            id: "env-1",
            cmd: "시세",
            meta: { discordUserId: "u1", guildId: "g1", channelId: "ch1" },
            args: '{"type":"mineral","hub":"jita"}',
        };

        const result = await marketPriceCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.data.embed).toBe(true);
        expect(result.data.embeds).toHaveLength(1);
        expect(result.data.embeds[0].fields).toHaveLength(3);
        expect(result.data.ephemeralReply).toBeDefined();
        const names = result.data.embeds[0].fields.map((f) => f.name);
        expect(names).toEqual(["Item", "Sell / Buy", "ISK·m³"]);
        const payload = buildDiscordReplyPayload(result.data);
        expect(payload.embeds?.length > 0 || payload.content).toBeTruthy();
    });

    test("type·hub 오류 → ok:false, data.error", async () => {
        const ctx = { redis: {}, tenantKey: "global" };
        const envelopeBadType = {
            id: "env-2",
            cmd: "시세",
            args: '{"type":"invalid","hub":"jita"}',
        };
        const envelopeBadHub = {
            id: "env-3",
            cmd: "시세",
            args: '{"type":"mineral","hub":"invalid"}',
        };

        const outType = await marketPriceCmd.execute(ctx, envelopeBadType);
        expect(outType.ok).toBe(false);
        expect(outType.data.error).toBeDefined();

        const outHub = await marketPriceCmd.execute(ctx, envelopeBadHub);
        expect(outHub.ok).toBe(false);
        expect(outHub.data.error).toContain("상권");
    });
});
