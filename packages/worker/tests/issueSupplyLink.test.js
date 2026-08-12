// packages/worker/tests/issueSupplyLink.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockIssueMagicLinkToken = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    issueMagicLinkToken: mockIssueMagicLinkToken,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { default: issueSupplyLink } = await import("../src/commands/issueSupplyLink.js");

describe("worker/commands/issueSupplyLink", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ADMIN_DISCORD_IDS = "111,222,333";
        process.env.STOCK_API_BASE_URL = "https://api.catalyst-for-you.com";
    });

    test("관리자 목록에 없으면 ok:false", async () => {
        const ctx = { redis: {}, tenantKey: "CAT" };
        const envelope = { meta: { discordUserId: "999" } };
        const out = await issueSupplyLink.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("관리자만");
        expect(mockIssueMagicLinkToken).not.toHaveBeenCalled();
    });

    test("redis 없음 → ok:false", async () => {
        const ctx = { tenantKey: "CAT" };
        const envelope = { meta: { discordUserId: "111" } };
        const out = await issueSupplyLink.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("시스템 설정 오류");
    });

    test("STOCK_API_BASE_URL 미설정 → ok:false", async () => {
        delete process.env.STOCK_API_BASE_URL;
        const ctx = { redis: {}, tenantKey: "CAT" };
        const envelope = { meta: { discordUserId: "111" } };
        const out = await issueSupplyLink.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("시스템 설정 오류");
    });

    test("관리자면 매직링크를 발급하고 URL을 회신한다", async () => {
        mockIssueMagicLinkToken.mockResolvedValue("abc-123-token");
        const ctx = { redis: {}, tenantKey: "CAT" };
        const envelope = { meta: { discordUserId: "111" } };

        const out = await issueSupplyLink.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(mockIssueMagicLinkToken).toHaveBeenCalledWith(
            ctx.redis,
            { discordId: "111", tenantKey: "CAT" },
            300
        );
        expect(out.data.description).toContain(
            "https://api.catalyst-for-you.com/auth/consume?token=abc-123-token"
        );
        expect(out.data.ephemeralReply).toBe(true);
    });

    test("STOCK_API_BASE_URL 끝에 슬래시가 있어도 중복 없이 붙는다", async () => {
        process.env.STOCK_API_BASE_URL = "https://api.catalyst-for-you.com/";
        mockIssueMagicLinkToken.mockResolvedValue("tok1");
        const ctx = { redis: {}, tenantKey: "CAT" };
        const envelope = { meta: { discordUserId: "222" } };

        const out = await issueSupplyLink.execute(ctx, envelope);

        expect(out.data.description).toContain(
            "https://api.catalyst-for-you.com/auth/consume?token=tok1"
        );
        expect(out.data.description).not.toContain("//auth/consume");
    });
});
