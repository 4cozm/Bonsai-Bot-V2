// packages/shared/tests/sessionJwt.test.js
import { describe, expect, jest, test } from "@jest/globals";
import { signSessionJwt, verifySessionJwt } from "../src/auth/sessionJwt.js";

const SECRET = "test-secret";

describe("shared/auth/sessionJwt", () => {
    test("서명 후 검증하면 원래 payload가 나온다", () => {
        const token = signSessionJwt({ discordId: "123", tenantKey: "CAT" }, SECRET, 3600);
        const payload = verifySessionJwt(token, SECRET);
        expect(payload.discordId).toBe("123");
        expect(payload.tenantKey).toBe("CAT");
        expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    test("다른 secret으로 검증하면 실패한다", () => {
        const token = signSessionJwt({ discordId: "123", tenantKey: "CAT" }, SECRET, 3600);
        expect(() => verifySessionJwt(token, "wrong-secret")).toThrow("서명이 일치하지 않습니다");
    });

    test("만료된 토큰은 검증 실패한다", () => {
        // expiresInSec은 최소 1초로 클램프되므로(음수 입력 방지), 실제로 시간을
        // 흘려보내서 만료시킨다.
        jest.useFakeTimers();
        try {
            const token = signSessionJwt({ discordId: "123", tenantKey: "CAT" }, SECRET, 1);
            jest.advanceTimersByTime(2000);
            expect(() => verifySessionJwt(token, SECRET)).toThrow("만료되었습니다");
        } finally {
            jest.useRealTimers();
        }
    });

    test("변조된 토큰(payload만 수정)은 서명 불일치로 실패한다", () => {
        const token = signSessionJwt({ discordId: "123", tenantKey: "CAT" }, SECRET, 3600);
        const [, sig] = token.split(".");
        const tampered =
            Buffer.from(JSON.stringify({ discordId: "999", tenantKey: "CAT" }))
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "") + `.${sig}`;
        expect(() => verifySessionJwt(tampered, SECRET)).toThrow("서명이 일치하지 않습니다");
    });

    test("형식이 잘못된 토큰은 예외를 던진다", () => {
        expect(() => verifySessionJwt("not-a-valid-token", SECRET)).toThrow(
            "형식이 올바르지 않습니다"
        );
    });
});
