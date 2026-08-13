// packages/worker/tests/setStockDivisionRule.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

await jest.unstable_mockModule("@bonsai/shared", () => ({
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { default: setStockDivisionRule } = await import("../src/commands/setStockDivisionRule.js");

const ADMIN_ID = "111";
const STRUCTURE_ID = 1051025995560n;

function baseArgs(overrides = {}) {
    return JSON.stringify({
        구조물: "1051025995560",
        행어: 4,
        추적: true,
        표시이름: "드론",
        컨테이너: "드론",
        ...overrides,
    });
}

describe("worker/commands/setStockDivisionRule", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ADMIN_DISCORD_IDS = "111,222";
    });

    test("관리자 목록에 없으면 ok:false", async () => {
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: "999" }, args: baseArgs() };
        const out = await setStockDivisionRule.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("관리자만");
    });

    test("prisma 없음 → 시스템 설정 오류", async () => {
        const ctx = {};
        const envelope = { meta: { discordUserId: ADMIN_ID }, args: baseArgs() };
        const out = await setStockDivisionRule.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("시스템 설정 오류");
    });

    test("구조물 item_id가 정수가 아니면 ok:false", async () => {
        const ctx = { prisma: { trackedStructure: { findUnique: jest.fn() } } };
        const envelope = {
            meta: { discordUserId: ADMIN_ID },
            args: baseArgs({ 구조물: "not-a-number" }),
        };
        const out = await setStockDivisionRule.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(ctx.prisma.trackedStructure.findUnique).not.toHaveBeenCalled();
    });

    test("행어 번호가 1~7 범위 밖이면 ok:false", async () => {
        const ctx = { prisma: { trackedStructure: { findUnique: jest.fn() } } };
        const envelope = {
            meta: { discordUserId: ADMIN_ID },
            args: baseArgs({ 행어: 8 }),
        };
        const out = await setStockDivisionRule.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(ctx.prisma.trackedStructure.findUnique).not.toHaveBeenCalled();
    });

    test("등록 안 된 구조물이면 ok:false", async () => {
        const ctx = {
            prisma: { trackedStructure: { findUnique: jest.fn().mockResolvedValue(null) } },
        };
        const envelope = { meta: { discordUserId: ADMIN_ID }, args: baseArgs() };
        const out = await setStockDivisionRule.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("재고구조물등록");
    });

    test("정상 입력 → upsert 후 전체 규칙 목록을 보여준다", async () => {
        const upsert = jest.fn().mockResolvedValue({});
        const findMany = jest.fn().mockResolvedValue([
            { division: 1, containerName: "", tracked: false, displayName: "store" },
            { division: 4, containerName: "드론", tracked: true, displayName: "드론" },
        ]);
        const ctx = {
            prisma: {
                trackedStructure: {
                    findUnique: jest
                        .fn()
                        .mockResolvedValue({ structureId: STRUCTURE_ID, displayName: "SAVE CAT" }),
                },
                stockDivisionRule: { upsert, findMany },
            },
        };
        const envelope = { meta: { discordUserId: ADMIN_ID }, args: baseArgs() };

        const out = await setStockDivisionRule.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(upsert).toHaveBeenCalledWith({
            where: {
                structureId_division_containerName: {
                    structureId: STRUCTURE_ID,
                    division: 4,
                    containerName: "드론",
                },
            },
            create: {
                structureId: STRUCTURE_ID,
                division: 4,
                containerName: "드론",
                tracked: true,
                displayName: "드론",
            },
            update: { tracked: true, displayName: "드론" },
        });
        expect(out.data.description).toContain("SAVE CAT");
        expect(out.data.description).toContain("드론");
        expect(out.data.description).toContain("store");
    });

    test("컨테이너를 생략하면 division 전체 규칙(containerName:null)로 upsert한다", async () => {
        const upsert = jest.fn().mockResolvedValue({});
        const ctx = {
            prisma: {
                trackedStructure: {
                    findUnique: jest
                        .fn()
                        .mockResolvedValue({ structureId: STRUCTURE_ID, displayName: "SAVE CAT" }),
                },
                stockDivisionRule: { upsert, findMany: jest.fn().mockResolvedValue([]) },
            },
        };
        const envelope = {
            meta: { discordUserId: ADMIN_ID },
            args: baseArgs({ 행어: 1, 추적: false, 표시이름: "store", 컨테이너: undefined }),
        };

        await setStockDivisionRule.execute(ctx, envelope);

        // null이 아니라 ""다 — MySQL 복합 유니크 인덱스 안의 nullable 컬럼은
        // Prisma가 upsert() where에 null을 못 쓰게 막는다(회귀 테스트).
        expect(upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    structureId_division_containerName: {
                        structureId: STRUCTURE_ID,
                        division: 1,
                        containerName: "",
                    },
                },
            })
        );
    });
});
