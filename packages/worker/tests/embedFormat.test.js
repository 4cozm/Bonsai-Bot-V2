// packages/worker/tests/embedFormat.test.js
import { describe, expect, test } from "@jest/globals";
import {
    displayWidth,
    padEndWide,
    padStartWide,
    sliceWide,
    fmtIskInteger,
    fmtSpreadPct,
    shortenItemName,
    formatMarketEmbedFields,
} from "../src/market/embedFormat.js";

describe("worker/market/embedFormat displayWidth", () => {
    test("ASCII 1칸", () => {
        expect(displayWidth("a")).toBe(1);
        expect(displayWidth("abc")).toBe(3);
    });
    test("한글 2칸", () => {
        expect(displayWidth("가")).toBe(2);
        expect(displayWidth("아르카노르")).toBe(10);
    });
    test("혼합", () => {
        expect(displayWidth("C50")).toBe(3);
        expect(displayWidth("풀러라이트-C50")).toBe(2 * 5 + 1 + 3); // 한글 5칸 + '-' 1칸 + 'C50' 3칸
    });
    test("서로게이트 페어(코드포인트 1개로 2바이트) 1칸", () => {
        const emoji = "👍";
        expect(emoji.length).toBe(2);
        expect(displayWidth(emoji)).toBe(1);
    });
});

describe("worker/market/embedFormat padEndWide", () => {
    test("width 미달 시 공백 추가", () => {
        expect(padEndWide("ab", 5)).toBe("ab   ");
        expect(padEndWide("가", 4)).toBe("가  ");
    });
    test("width 이상이면 그대로", () => {
        expect(padEndWide("abcde", 5)).toBe("abcde");
        expect(padEndWide("가나", 4)).toBe("가나");
    });
});

describe("worker/market/embedFormat padStartWide", () => {
    test("width 미달 시 앞에 공백", () => {
        expect(padStartWide("12", 5)).toBe("   12");
        expect(padStartWide("가", 4)).toBe("  가");
    });
    test("width 이상이면 그대로", () => {
        expect(padStartWide("12345", 5)).toBe("12345");
    });
});

describe("worker/market/embedFormat sliceWide", () => {
    test("maxWidth 이하면 그대로", () => {
        expect(sliceWide("ab", 5)).toBe("ab");
        expect(sliceWide("가나", 4)).toBe("가나");
    });
    test("초과 시 잘리고 …", () => {
        expect(sliceWide("abcdef", 4)).toBe("abc…");
        expect(sliceWide("아르카노르", 6)).toMatch(/…$/);
    });
    test("maxWidth 0 → 빈 문자열 또는 …", () => {
        const r = sliceWide("ab", 0);
        expect(r === "" || r === "…").toBe(true);
    });
});

describe("worker/market/embedFormat fmtIskInteger", () => {
    test("null/음수/비정상 → —", () => {
        expect(fmtIskInteger(null)).toBe("—");
        expect(fmtIskInteger(undefined)).toBe("—");
        expect(fmtIskInteger(-1)).toBe("—");
        expect(fmtIskInteger(NaN)).toBe("—");
    });
    test("양수 → 콤마 정수", () => {
        expect(fmtIskInteger(86000)).toBe("86,000");
        expect(fmtIskInteger(1234567)).toBe("1,234,567");
    });
});

describe("worker/market/embedFormat fmtSpreadPct", () => {
    test("sell/buy null 또는 sell≤0 → —", () => {
        expect(fmtSpreadPct(null, 100)).toBe("—");
        expect(fmtSpreadPct(100, null)).toBe("—");
        expect(fmtSpreadPct(0, 50)).toBe("—");
    });
    test("정상 퍼센트", () => {
        expect(fmtSpreadPct(100, 50)).toBe("50.0%");
        expect(fmtSpreadPct(100, 90)).toBe("10.0%");
    });
});

describe("worker/market/embedFormat shortenItemName", () => {
    test("fullerite: Fullerite- / 풀러라이트- 제거", () => {
        expect(shortenItemName("Fullerite-C50", "fullerite")).toBe("C50");
        expect(shortenItemName("풀러라이트-C320", "fullerite")).toBe("C320");
    });
    test("mineral: 압축된 제거", () => {
        expect(shortenItemName("압축된 아르카노르", "mineral")).toBe("아르카노르");
    });
    test("12자 초과 시 …", () => {
        expect(shortenItemName("1234567890123", "mineral")).toBe("123456789012…");
    });
});

describe("worker/market/embedFormat formatMarketEmbedFields", () => {
    test("rows → itemValue, sellBuyValue, iskm3Value 형식", () => {
        const rows = [
            { item: "C50", sell: 16200, buy: 9304, iskm3: 101250 },
            { item: "아르카노르", sell: null, buy: null, iskm3: null },
        ];
        const out = formatMarketEmbedFields(rows);
        expect(out.itemValue).toBe("C50\n아르카노르");
        expect(out.sellBuyValue).toBe("16,200 / 9,304\n— / —");
        expect(out.iskm3Value).toBe("101,250\n—");
    });
    test("빈 rows", () => {
        const out = formatMarketEmbedFields([]);
        expect(out.itemValue).toBe("");
        expect(out.sellBuyValue).toBe("");
        expect(out.iskm3Value).toBe("");
    });
});
