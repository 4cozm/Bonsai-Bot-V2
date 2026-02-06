// packages/shared/tests/parseEveEsiScope.test.js
import { describe, expect, test } from "@jest/globals";
import { parseEveEsiScope } from "../src/esi/parseEveEsiScope.js";

const DEFAULT_SCOPE = "esi-character.read_character.v1";
const REQUIRED_MSG =
    "EVE_ESI_SCOPE가 필요합니다. (운영에서는 Key Vault에 JSON 배열 또는 공백 구분 문자열로 설정)";
const INVALID_JSON_MSG =
    "EVE_ESI_SCOPE JSON 형식이 잘못되었습니다. (JSON 배열 또는 공백 구분 문자열로 설정)";

describe("shared/esi/parseEveEsiScope", () => {
    test("빈 값 + required → throw", () => {
        expect(() => parseEveEsiScope("", { required: true })).toThrow(REQUIRED_MSG);
        expect(() => parseEveEsiScope("   ", { required: true })).toThrow(REQUIRED_MSG);
        expect(() => parseEveEsiScope(undefined, { required: true })).toThrow(REQUIRED_MSG);
    });

    test("빈 값 + optional → DEFAULT_SCOPE", () => {
        expect(parseEveEsiScope("")).toBe(DEFAULT_SCOPE);
        expect(parseEveEsiScope("   ")).toBe(DEFAULT_SCOPE);
        expect(parseEveEsiScope(undefined)).toBe(DEFAULT_SCOPE);
        expect(parseEveEsiScope(null)).toBe(DEFAULT_SCOPE);
    });

    test("JSON 배열 → 공백 join", () => {
        expect(parseEveEsiScope('["publicData","esi-character.read_character.v1"]')).toBe(
            "publicData esi-character.read_character.v1"
        );
        expect(parseEveEsiScope('["a"]')).toBe("a");
        expect(parseEveEsiScope('["a", "b", "c"]')).toBe("a b c");
    });

    test("JSON 배열 내 빈/공백 요소 제거 후 join", () => {
        expect(parseEveEsiScope('["a", "", "b", "  ", "c"]')).toBe("a b c");
    });

    test("JSON 파싱 실패 + required → INVALID_JSON_MSG", () => {
        expect(() => parseEveEsiScope("[invalid", { required: true })).toThrow(INVALID_JSON_MSG);
        expect(() => parseEveEsiScope("[}", { required: true })).toThrow(INVALID_JSON_MSG);
    });

    test("JSON 파싱 실패 + optional → raw 그대로 반환", () => {
        expect(parseEveEsiScope("[invalid")).toBe("[invalid");
    });

    test("JSON 객체( [ 로 시작 안 함 ) + required → 공백 구분 문자열로 그대로 반환", () => {
        // [ 로 시작하지 않으면 JSON 파싱하지 않고 raw 그대로 반환
        expect(parseEveEsiScope('{"x":1}', { required: true })).toBe('{"x":1}');
    });

    test("JSON 배열이 빈 배열 + required → REQUIRED_MSG", () => {
        expect(() => parseEveEsiScope("[]", { required: true })).toThrow(REQUIRED_MSG);
    });

    test("JSON 배열이 빈 배열 + optional → DEFAULT_SCOPE", () => {
        expect(parseEveEsiScope("[]")).toBe(DEFAULT_SCOPE);
    });

    test("공백 구분 문자열 → trim 후 그대로 반환", () => {
        expect(parseEveEsiScope("publicData esi-character.read_character.v1")).toBe(
            "publicData esi-character.read_character.v1"
        );
        expect(parseEveEsiScope("  publicData  ")).toBe("publicData");
    });
});
