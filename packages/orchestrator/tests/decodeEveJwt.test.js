// packages/orchestrator/tests/decodeEveJwt.test.js
import { describe, expect, test } from "@jest/globals";
import { decodeEveJwtPayload } from "../src/esi/decodeEveJwt.js";

function base64urlEncode(str) {
    const b64 = Buffer.from(str, "utf8").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function makeJwt(payload) {
    const header = base64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payloadPart = base64urlEncode(JSON.stringify(payload));
    return `${header}.${payloadPart}.fakeSignature`;
}

describe("orchestrator/esi/decodeEveJwt", () => {
    test("빈/null jwt → null", () => {
        expect(decodeEveJwtPayload("")).toBeNull();
        expect(decodeEveJwtPayload(null)).toBeNull();
        expect(decodeEveJwtPayload("   ")).toBeNull();
    });

    test("parts !== 3 → null", () => {
        expect(decodeEveJwtPayload("a")).toBeNull();
        expect(decodeEveJwtPayload("a.b")).toBeNull();
        expect(decodeEveJwtPayload("a.b.c.d")).toBeNull();
    });

    test("유효한 sub/name → characterId, characterName 반환", () => {
        const jwt = makeJwt({
            sub: "CHARACTER:EVE:12345678",
            name: "Eve Pilot",
        });
        const result = decodeEveJwtPayload(jwt);
        expect(result).toEqual({
            characterId: 12345678n,
            characterName: "Eve Pilot",
        });
    });

    test("sub 형식 이상 → null", () => {
        expect(decodeEveJwtPayload(makeJwt({ sub: "INVALID", name: "X" }))).toBeNull();
        expect(decodeEveJwtPayload(makeJwt({ sub: "CHARACTER:EVE:abc", name: "X" }))).toBeNull();
    });

    test("name 없음 → null", () => {
        expect(decodeEveJwtPayload(makeJwt({ sub: "CHARACTER:EVE:123", name: "" }))).toBeNull();
        expect(decodeEveJwtPayload(makeJwt({ sub: "CHARACTER:EVE:123" }))).toBeNull();
    });

    test("payload 파싱 실패(잘못된 base64) → null", () => {
        const bad = "eyJhbGciOiJSUzI1NiJ9.not-valid-base64!!!.sig";
        expect(decodeEveJwtPayload(bad)).toBeNull();
    });
});
