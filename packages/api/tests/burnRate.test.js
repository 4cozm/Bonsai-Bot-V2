// packages/api/tests/burnRate.test.js
import { describe, expect, test } from "@jest/globals";
import { computeBurnRatePerDay, computeDaysLeft } from "../src/stock/burnRate.js";

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n) {
    return new Date(Date.now() - n * DAY_MS);
}

describe("api/stock/burnRate", () => {
    describe("computeBurnRatePerDay", () => {
        test("표본이 1개 이하면 0", () => {
            expect(computeBurnRatePerDay([], 30)).toBe(0);
            expect(computeBurnRatePerDay([{ sampledAt: daysAgo(0), quantity: 10 }], 30)).toBe(0);
        });

        test("감소분만 더하고 보급(증가)은 무시한다", () => {
            const history = [
                { sampledAt: daysAgo(4), quantity: 100 },
                { sampledAt: daysAgo(3), quantity: 80 }, // -20
                { sampledAt: daysAgo(2), quantity: 150 }, // 보급, 무시
                { sampledAt: daysAgo(1), quantity: 130 }, // -20
                { sampledAt: daysAgo(0), quantity: 130 },
            ];
            // 총 감소 40, 구간 4일 → 하루 10
            expect(computeBurnRatePerDay(history, 30)).toBeCloseTo(10, 5);
        });

        test("windowDays 밖의 오래된 표본은 제외한다", () => {
            const history = [
                { sampledAt: daysAgo(100), quantity: 1000 }, // 창 밖 — 제외돼야 함
                { sampledAt: daysAgo(2), quantity: 50 },
                { sampledAt: daysAgo(0), quantity: 30 }, // -20, 2일
            ];
            expect(computeBurnRatePerDay(history, 30)).toBeCloseTo(10, 5);
        });

        test("소비가 전혀 없으면 0", () => {
            const history = [
                { sampledAt: daysAgo(2), quantity: 50 },
                { sampledAt: daysAgo(1), quantity: 60 },
                { sampledAt: daysAgo(0), quantity: 70 },
            ];
            expect(computeBurnRatePerDay(history, 30)).toBe(0);
        });
    });

    describe("computeDaysLeft", () => {
        test("소비 속도가 0 이하면 null(무제한)", () => {
            expect(computeDaysLeft(100, 0)).toBeNull();
            expect(computeDaysLeft(100, -1)).toBeNull();
        });

        test("재고 ÷ 일일소비량", () => {
            expect(computeDaysLeft(100, 10)).toBe(10);
            expect(computeDaysLeft(15, 4)).toBeCloseTo(3.75, 5);
        });
    });
});
