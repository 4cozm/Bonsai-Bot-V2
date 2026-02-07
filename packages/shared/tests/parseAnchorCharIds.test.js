// packages/shared/tests/parseAnchorCharIds.test.js
import { describe, expect, test } from "@jest/globals";
import { parseAnchorCharIds } from "../src/esi/parseAnchorCharIds.js";

describe("shared/esi/parseAnchorCharIds", () => {
    test("빈 값/undefined/null/공백 → []", () => {
        expect(parseAnchorCharIds("")).toEqual([]);
        expect(parseAnchorCharIds("   ")).toEqual([]);
        expect(parseAnchorCharIds(undefined)).toEqual([]);
        expect(parseAnchorCharIds(null)).toEqual([]);
    });

    test("정상 단일: 123:456 → [{ corporationId: 123, characterId: 456n }]", () => {
        const out = parseAnchorCharIds("123:456");
        expect(out).toHaveLength(1);
        expect(out[0].corporationId).toBe(123);
        expect(out[0].characterId).toBe(456n);
    });

    test("복수: 123:456, 789:101112 → 2개 요소, trim", () => {
        const out = parseAnchorCharIds("123:456, 789:101112");
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({ corporationId: 123, characterId: 456n });
        expect(out[1]).toEqual({ corporationId: 789, characterId: 101112n });
    });

    test("무효 nocolon → 해당 쌍 스킵", () => {
        expect(parseAnchorCharIds("nocolon")).toEqual([]);
    });

    test("무효 123: (끝 콜론만) → 스킵", () => {
        expect(parseAnchorCharIds("123:")).toEqual([]);
    });

    test("무효 :456 (시작 콜론만) → 스킵", () => {
        expect(parseAnchorCharIds(":456")).toEqual([]);
    });

    test("무효 0:456 (corporationId 0) → 스킵", () => {
        expect(parseAnchorCharIds("0:456")).toEqual([]);
    });

    test("123:0 (characterId 0) → 구현 정책상 허용 시 1개 반환", () => {
        const out = parseAnchorCharIds("123:0");
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ corporationId: 123, characterId: 0n });
    });

    test("일부만 유효: 1:2,bad,3:4 → 2개만 반환", () => {
        const out = parseAnchorCharIds("1:2,bad,3:4");
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({ corporationId: 1, characterId: 2n });
        expect(out[1]).toEqual({ corporationId: 3, characterId: 4n });
    });
});
