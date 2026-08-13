// packages/api/tests/session.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockVerifySessionJwt = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    verifySessionJwt: mockVerifySessionJwt,
}));

const { readSession, requireSession } = await import("../src/auth/session.js");

function makeReq(cookieHeader) {
    return { headers: { cookie: cookieHeader } };
}

describe("api/auth/session", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.STOCK_SESSION_JWT_SECRET = "test-secret";
    });

    describe("readSession", () => {
        test("쿠키 헤더가 없으면 null", () => {
            expect(readSession(makeReq(undefined))).toBeNull();
            expect(mockVerifySessionJwt).not.toHaveBeenCalled();
        });

        test("다른 쿠키만 있고 세션 쿠키가 없으면 null", () => {
            expect(readSession(makeReq("foo=bar; baz=qux"))).toBeNull();
        });

        test("STOCK_SESSION_JWT_SECRET 미설정이면 쿠키가 있어도 null", () => {
            delete process.env.STOCK_SESSION_JWT_SECRET;
            expect(readSession(makeReq("bonsai_session=abc"))).toBeNull();
        });

        test("검증 실패(만료 등)면 null", () => {
            mockVerifySessionJwt.mockImplementation(() => {
                throw new Error("만료되었습니다");
            });
            expect(readSession(makeReq("bonsai_session=abc"))).toBeNull();
        });

        test("여러 쿠키 중 세션 쿠키만 정확히 뽑아서 검증한다", () => {
            mockVerifySessionJwt.mockReturnValue({ discordId: "111", tenantKey: "CAT" });
            const session = readSession(makeReq("foo=bar; bonsai_session=the-token; baz=qux"));
            expect(session).toEqual({ discordId: "111", tenantKey: "CAT" });
            expect(mockVerifySessionJwt).toHaveBeenCalledWith("the-token", "test-secret");
        });
    });

    describe("requireSession", () => {
        test("세션 없으면 401을 응답하고 next()는 안 부른다", () => {
            const req = makeReq(undefined);
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };
            const next = jest.fn();

            requireSession(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        test("세션이 유효하면 req.session에 담고 next()를 부른다", () => {
            mockVerifySessionJwt.mockReturnValue({ discordId: "111", tenantKey: "CAT" });
            const req = makeReq("bonsai_session=abc");
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            const next = jest.fn();

            requireSession(req, res, next);

            expect(req.session).toEqual({ discordId: "111", tenantKey: "CAT" });
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
    });
});
