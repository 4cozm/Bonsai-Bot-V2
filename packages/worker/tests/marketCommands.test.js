// packages/worker/tests/marketCommands.test.js
import { describe, expect, jest, test } from "@jest/globals";

// Mock cache so 시세 조회 성공 경로 테스트 가능
await jest.unstable_mockModule("../src/market/esiMarketCache.js", () => ({
    getMarketPrice: jest.fn().mockResolvedValue({
        sellMin: 16200,
        buyMax: 9304,
        fetchedAt: Math.floor(Date.now() / 1000),
        stale: false,
    }),
}));

const marketPrice = (await import("../src/commands/marketPrice.js")).default;

describe("worker/commands 시세 (marketPrice) type·hub 검증·에러 형식", () => {
    test("type 없음/잘못된 type → ok:false, data.error 메시지", async () => {
        const ctx = { redis: {}, tenantKey: "CAT" };
        const envelopeNoType = { args: '{"hub":"jita"}' };
        const envelopeBadType = { args: '{"type":"x","hub":"jita"}' };

        const outNoType = await marketPrice.execute(ctx, envelopeNoType);
        expect(outNoType.ok).toBe(false);
        expect(outNoType.data.error).toContain("시세 종류");

        const outBadType = await marketPrice.execute(ctx, envelopeBadType);
        expect(outBadType.ok).toBe(false);
        expect(outBadType.data.error).toContain("시세 종류");
    });

    test("hub 없음/잘못된 hub → ok:false, data.error 메시지", async () => {
        const ctx = { redis: {}, tenantKey: "CAT" };
        const envelopeNoHub = { args: '{"type":"mineral"}' };
        const envelopeBadHub = { args: '{"type":"mineral","hub":"invalid"}' };

        const outNoHub = await marketPrice.execute(ctx, envelopeNoHub);
        expect(outNoHub.ok).toBe(false);
        expect(outNoHub.data).toEqual(
            expect.objectContaining({
                error: "지원하지 않는 상권입니다. 지타/아마르/헤크/도딕시/렌스 중 선택해 주세요.",
            })
        );

        const outBadHub = await marketPrice.execute(ctx, envelopeBadHub);
        expect(outBadHub.ok).toBe(false);
        expect(outBadHub.data.error).toContain("지원하지 않는 상권");
    });

    test("redis 없음 → ok:false, data.error 시스템 설정 오류", async () => {
        const ctx = { redis: null, tenantKey: "CAT" };
        const envelope = { args: '{"type":"mineral","hub":"jita"}' };

        const out = await marketPrice.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("시스템 설정 오류");
    });
});

describe("worker/commands 시세 (marketPrice) 정상 시 embed 구조·ephemeral", () => {
    test("type mineral, hub jita + mock cache → ok:true, embeds[0].fields 3개·ephemeralReply 기본 true", async () => {
        const ctx = { redis: {}, tenantKey: "global" };
        const envelope = { args: '{"type":"mineral","hub":"jita"}' };

        const out = await marketPrice.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(out.data.embed).toBe(true);
        expect(out.data.ephemeralReply).toBe(true);
        expect(Array.isArray(out.data.embeds)).toBe(true);
        expect(out.data.embeds.length).toBe(1);
        const embed = out.data.embeds[0];
        expect(embed.fields).toHaveLength(3);
        const names = embed.fields.map((f) => f.name);
        expect(names).toEqual(["Item", "Sell / Buy", "ISK·m³"]);
        embed.fields.forEach((f) => expect(f.inline).toBe(true));
    });

    test("ephemeral false → data.ephemeralReply false", async () => {
        const ctx = { redis: {}, tenantKey: "global" };
        const envelope = { args: '{"type":"mineral","hub":"jita","ephemeral":false}' };

        const out = await marketPrice.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(out.data.ephemeralReply).toBe(false);
    });
});
