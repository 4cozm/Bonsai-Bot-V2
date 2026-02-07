// packages/shared/tests/refreshEveToken.test.js
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { refreshEveToken } from "../src/esi/refreshEveToken.js";

describe("shared/esi/refreshEveToken", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("refreshToken 빈 문자열 → null", async () => {
        const result = await refreshEveToken({
            refreshToken: "",
            clientId: "c",
            clientSecret: "s",
        });
        expect(result).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled?.();
    });

    test("refreshToken 공백만 → null", async () => {
        const result = await refreshEveToken({
            refreshToken: "   ",
            clientId: "c",
            clientSecret: "s",
        });
        expect(result).toBeNull();
    });

    test("res.ok === true, access_token 있음 → 객체 반환, expires_in 기본값", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    access_token: "new-jwt",
                }),
        });

        const result = await refreshEveToken({
            refreshToken: "rt",
            clientId: "cid",
            clientSecret: "secret",
        });

        expect(result).not.toBeNull();
        expect(result.access_token).toBe("new-jwt");
        expect(result.expires_in).toBe(1200);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "https://login.eveonline.com/v2/oauth/token",
            expect.objectContaining({
                method: "POST",
                headers: {
                    Authorization: "Basic " + Buffer.from("cid:secret").toString("base64"),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            })
        );
    });

    test("res.ok === false → null", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
            text: () => Promise.resolve("invalid refresh"),
        });

        const result = await refreshEveToken({
            refreshToken: "rt",
            clientId: "c",
            clientSecret: "s",
        });

        expect(result).toBeNull();
    });

    test("res.ok true, refresh_token·expires_in 포함 → 반환값에 반영", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    access_token: "at",
                    refresh_token: "new-rt",
                    expires_in: 1800,
                }),
        });

        const result = await refreshEveToken({
            refreshToken: "rt",
            clientId: "c",
            clientSecret: "s",
        });

        expect(result).toEqual({
            access_token: "at",
            refresh_token: "new-rt",
            expires_in: 1800,
        });
    });

    test("res.ok true, access_token 없음 → null", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });

        const result = await refreshEveToken({
            refreshToken: "rt",
            clientId: "c",
            clientSecret: "s",
        });

        expect(result).toBeNull();
    });
});
