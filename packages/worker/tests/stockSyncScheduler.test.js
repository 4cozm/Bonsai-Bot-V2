// packages/worker/tests/stockSyncScheduler.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockGetAccessTokenForCharacter = jest.fn();
const mockParseAnchorCharIds = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    parseAnchorCharIds: mockParseAnchorCharIds,
    getAccessTokenForCharacter: mockGetAccessTokenForCharacter,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { aggregateHangarStock, syncStructure } =
    await import("../src/schedulers/stockSyncScheduler.js");

const STRUCTURE_ID = 1051025995560n;
const OFFICE_ITEM_ID = 1051038381605;

describe("stockSyncScheduler/aggregateHangarStock", () => {
    test("CorpSAG 플래그를 가진 직속 자식만 있으면 그대로 합산한다", () => {
        const assets = [
            {
                item_id: 1,
                type_id: 100,
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG3",
                quantity: 2,
            },
            {
                item_id: 2,
                type_id: 100,
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG3",
                quantity: 3,
            },
            {
                item_id: 3,
                type_id: 200,
                location_id: STRUCTURE_ID,
                location_flag: "HiSlot0",
                quantity: 1,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);
        expect(result.get(100)).toBe(5);
        expect(result.has(200)).toBe(false);
    });

    test("행어 안 컨테이너 내용물은 자기 flag가 달라도 상위 CorpSAG division을 상속받는다", () => {
        const CONTAINER_ID = 999;
        const assets = [
            // 구조물 → 오피스 → CorpSAG4(컨테이너) → 컨테이너 내용물(Unlocked)
            {
                item_id: OFFICE_ITEM_ID,
                type_id: 27,
                location_id: STRUCTURE_ID,
                location_flag: "OfficeFolder",
                quantity: 1,
            },
            {
                item_id: CONTAINER_ID,
                type_id: 3465, // "3.탄약" 같은 커스텀 컨테이너
                location_id: OFFICE_ITEM_ID,
                location_flag: "CorpSAG4",
                quantity: 1,
            },
            {
                item_id: 5001,
                type_id: 21896, // Republic Fleet EMP M
                location_id: CONTAINER_ID,
                location_flag: "Unlocked",
                quantity: 500,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);
        // 컨테이너 자체(type_id=3465)도 하나의 typeId로 집계되고,
        // 그 안의 탄약(type_id=21896)도 상속받아 집계된다.
        expect(result.get(3465)).toBe(1);
        expect(result.get(21896)).toBe(500);
        // 오피스 자체(type_id=27)는 division이 없어서 집계 대상이 아니다.
        expect(result.has(27)).toBe(false);
    });

    test("구조물 자체 피팅(HiSlot 등)은 division 상속 없이 전부 무시한다", () => {
        const FITTED_MODULE_ID = 777;
        const assets = [
            {
                item_id: FITTED_MODULE_ID,
                type_id: 12058,
                location_id: STRUCTURE_ID,
                location_flag: "HiSlot0",
                quantity: 1,
            },
            {
                item_id: 888,
                type_id: 34,
                location_id: FITTED_MODULE_ID,
                location_flag: "Unlocked",
                quantity: 10,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);
        expect(result.size).toBe(0);
    });
});

describe("stockSyncScheduler/syncStructure", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("토큰이 없으면 StockLog를 기록하지 않고 조용히 스킵한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue(null);
        const prisma = { stockLog: { createMany: jest.fn() } };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(prisma.stockLog.createMany).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });

    test("정상 흐름: 콥 자산을 받아 집계해서 StockLog.createMany를 호출한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: { get: () => "1" },
            json: async () => [
                {
                    item_id: 1,
                    type_id: 100,
                    location_id: STRUCTURE_ID,
                    location_flag: "CorpSAG1",
                    quantity: 7,
                },
            ],
        }));
        const prisma = { stockLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(prisma.stockLog.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({
                    structureId: STRUCTURE_ID,
                    typeId: 100,
                    quantity: 7,
                }),
            ],
        });
    });

    test("콥 자산 조회가 실패하면(non-ok) StockLog를 기록하지 않는다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async () => ({ ok: false, status: 403 }));
        const prisma = { stockLog: { createMany: jest.fn() } };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(prisma.stockLog.createMany).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });
});
