// packages/api/tests/auth.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockConsumeMagicLinkToken = jest.fn();
const mockSignSessionJwt = jest.fn();
const mockVerifySessionJwt = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    consumeMagicLinkToken: mockConsumeMagicLinkToken,
    signSessionJwt: mockSignSessionJwt,
    verifySessionJwt: mockVerifySessionJwt,
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

    test("token 없으면 JSON 대신 프론트 안내 페이지로 리다이렉트한다", async () => {
        const { server, baseUrl } = startTestApp();
        try {
            const res = await fetch(`${baseUrl}/auth/consume`, { redirect: "manual" });
            expect(res.status).toBe(302);
            expect(res.headers.get("location")).toBe(
                "https://supply.catalyst-for-you.com?authError=missing_token"
            );
            expect(mockConsumeMagicLinkToken).not.toHaveBeenCalled();
        } finally {
            server.close();
        }
    });

    test("만료/이미 사용된 토큰이면 JSON 대신 프론트 안내 페이지로 리다이렉트한다", async () => {
        mockConsumeMagicLinkToken.mockResolvedValue(null);
        const { server, baseUrl } = startTestApp();
        try {
            const res = await fetch(`${baseUrl}/auth/consume?token=expired`, {
                redirect: "manual",
            });
            expect(res.status).toBe(302);
            expect(res.headers.get("location")).toBe(
                "https://supply.catalyst-for-you.com?authError=expired_link"
            );
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

    describe("GET /auth/me", () => {
        test("쿠키가 없으면 401", async () => {
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/auth/me`);
                expect(res.status).toBe(401);
                expect(mockVerifySessionJwt).not.toHaveBeenCalled();
            } finally {
                server.close();
            }
        });

        test("쿠키가 있지만 검증 실패(만료/위조)면 401", async () => {
            mockVerifySessionJwt.mockImplementation(() => {
                throw new Error("만료되었습니다");
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/auth/me`, {
                    headers: { cookie: `${SESSION_COOKIE_NAME}=bad-token` },
                });
                expect(res.status).toBe(401);
            } finally {
                server.close();
            }
        });

        test("유효한 세션 쿠키면 discordId/tenantKey를 반환한다", async () => {
            mockVerifySessionJwt.mockReturnValue({
                discordId: "111",
                tenantKey: "CAT",
                iat: 1,
                exp: 2,
            });
            const { server, baseUrl } = startTestApp();
            try {
                const res = await fetch(`${baseUrl}/auth/me`, {
                    headers: { cookie: `${SESSION_COOKIE_NAME}=good-token` },
                });
                const body = await res.json();
                expect(res.status).toBe(200);
                expect(body).toEqual({ ok: true, discordId: "111", tenantKey: "CAT" });
                expect(mockVerifySessionJwt).toHaveBeenCalledWith("good-token", "test-secret");
            } finally {
                server.close();
            }
        });
    });
});
