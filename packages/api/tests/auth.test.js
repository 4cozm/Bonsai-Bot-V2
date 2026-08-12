// packages/api/tests/auth.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockConsumeMagicLinkToken = jest.fn();
const mockSignSessionJwt = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    consumeMagicLinkToken: mockConsumeMagicLinkToken,
    signSessionJwt: mockSignSessionJwt,
}));

const { createApp } = await import("../src/server.js");
const { SESSION_COOKIE_NAME } = await import("../src/routes/auth.js");

function startTestApp() {
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const app = createApp({ redis: {}, log });
    const server = app.listen(0);
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("api/routes/auth", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.STOCK_SESSION_JWT_SECRET = "test-secret";
        process.env.STOCK_FRONTEND_URL = "https://supply.catalyst-for-you.com";
    });

    test("token 없으면 400", async () => {
        const { server, baseUrl } = startTestApp();
        try {
            const res = await fetch(`${baseUrl}/auth/consume`, { redirect: "manual" });
            expect(res.status).toBe(400);
            expect(mockConsumeMagicLinkToken).not.toHaveBeenCalled();
        } finally {
            server.close();
        }
    });

    test("만료/이미 사용된 토큰이면 400", async () => {
        mockConsumeMagicLinkToken.mockResolvedValue(null);
        const { server, baseUrl } = startTestApp();
        try {
            const res = await fetch(`${baseUrl}/auth/consume?token=expired`, {
                redirect: "manual",
            });
            const body = await res.json();
            expect(res.status).toBe(400);
            expect(body.error).toContain("만료");
        } finally {
            server.close();
        }
    });

    test("유효한 토큰이면 세션 쿠키를 설정하고 프론트로 302 리다이렉트한다", async () => {
        mockConsumeMagicLinkToken.mockResolvedValue({ discordId: "111", tenantKey: "CAT" });
        mockSignSessionJwt.mockReturnValue("signed-session-token");
        const { server, baseUrl } = startTestApp();
        try {
            const res = await fetch(`${baseUrl}/auth/consume?token=abc`, { redirect: "manual" });

            expect(mockConsumeMagicLinkToken).toHaveBeenCalledWith(expect.anything(), "abc");
            expect(mockSignSessionJwt).toHaveBeenCalledWith(
                { discordId: "111", tenantKey: "CAT" },
                "test-secret",
                7 * 24 * 60 * 60
            );
            expect(res.status).toBe(302);
            expect(res.headers.get("location")).toBe("https://supply.catalyst-for-you.com");
            const setCookie = res.headers.get("set-cookie");
            expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=signed-session-token`);
            expect(setCookie).toContain("HttpOnly");
            expect(setCookie).toContain("SameSite=Lax");
        } finally {
            server.close();
        }
    });

    test("STOCK_SESSION_JWT_SECRET 미설정이면 500", async () => {
        delete process.env.STOCK_SESSION_JWT_SECRET;
        mockConsumeMagicLinkToken.mockResolvedValue({ discordId: "111", tenantKey: "CAT" });
        const { server, baseUrl } = startTestApp();
        try {
            const res = await fetch(`${baseUrl}/auth/consume?token=abc`, { redirect: "manual" });
            expect(res.status).toBe(500);
        } finally {
            server.close();
        }
    });
});
