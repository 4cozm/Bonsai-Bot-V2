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

const mineralPrice = (await import("../src/commands/mineralPrice.js")).default;

describe("worker/commands 시세 (광물시세) hub 검증·에러 형식", () => {
    test("hub 없음/잘못된 hub → ok:false, data.error 메시지", async () => {
        const ctx = { redis: {}, tenantKey: "CAT" };
        const envelopeNoHub = { args: "{}" };
        const envelopeBadHub = { args: '{"hub":"invalid"}' };

        const outNoHub = await mineralPrice.execute(ctx, envelopeNoHub);
        expect(outNoHub.ok).toBe(false);
        expect(outNoHub.data).toEqual(
            expect.objectContaining({
                error: "지원하지 않는 상권입니다. 지타/아마르/헤크/도딕시/렌스 중 선택해 주세요.",
            })
        );

        const outBadHub = await mineralPrice.execute(ctx, envelopeBadHub);
        expect(outBadHub.ok).toBe(false);
        expect(outBadHub.data.error).toContain("지원하지 않는 상권");
    });

    test("redis 없음 → ok:false, data.error 시스템 설정 오류", async () => {
        const ctx = { redis: null, tenantKey: "CAT" };
        const envelope = { args: '{"hub":"jita"}' };

        const out = await mineralPrice.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("시스템 설정 오류");
    });
});

describe("worker/commands 시세 (광물시세) 정상 시 embed 구조", () => {
    test("hub jita + mock cache → ok:true, embeds[0].fields 3개·inline true", async () => {
        const ctx = { redis: {}, tenantKey: "global" };
        const envelope = { args: '{"hub":"jita"}' };

        const out = await mineralPrice.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(out.data.embed).toBe(true);
        expect(Array.isArray(out.data.embeds)).toBe(true);
        expect(out.data.embeds.length).toBe(1);
        const embed = out.data.embeds[0];
        expect(embed.fields).toHaveLength(3);
        const names = embed.fields.map((f) => f.name);
        expect(names).toEqual(["Item", "Sell / Buy", "ISK·m³"]);
        embed.fields.forEach((f) => expect(f.inline).toBe(true));
    });
});
