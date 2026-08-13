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

function find(result, typeId) {
    return result.find((r) => r.typeId === typeId);
}

describe("stockSyncScheduler/aggregateHangarStock", () => {
    test("CorpSAG 플래그를 가진 직속 자식만 있으면 그대로 합산하고 컨테이너 없음으로 표시한다", () => {
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
        expect(find(result, 100)).toEqual({
            typeId: 100,
            division: 3,
            containerItemId: null,
            quantity: 5,
        });
        expect(find(result, 200)).toBeUndefined();
    });

    test("행어 안 컨테이너 내용물은 자기 flag가 달라도 상위 CorpSAG division을 상속받고, 컨테이너 item_id도 물려받는다", () => {
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
        // 컨테이너 자체(type_id=3465)는 division에 직접 있는 것이라 containerItemId가 없다.
        expect(find(result, 3465)).toEqual({
            typeId: 3465,
            division: 4,
            containerItemId: null,
            quantity: 1,
        });
        // 그 안의 탄약(type_id=21896)은 컨테이너(item_id=999) 소속으로 집계된다.
        expect(find(result, 21896)).toEqual({
            typeId: 21896,
            division: 4,
            containerItemId: CONTAINER_ID,
            quantity: 500,
        });
        // 오피스 자체(type_id=27)는 division이 없어서 집계 대상이 아니다.
        expect(find(result, 27)).toBeUndefined();
    });

    test("같은 typeId라도 division이나 컨테이너가 다르면 따로 집계된다", () => {
        const CONTAINER_ID = 999;
        const assets = [
            {
                item_id: 1,
                type_id: 100,
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG3",
                quantity: 10,
            },
            {
                item_id: CONTAINER_ID,
                type_id: 3465,
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG4",
                quantity: 1,
            },
            {
                item_id: 2,
                type_id: 100,
                location_id: CONTAINER_ID,
                location_flag: "Unlocked",
                quantity: 20,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);
        expect(result.filter((r) => r.typeId === 100)).toEqual([
            { typeId: 100, division: 3, containerItemId: null, quantity: 10 },
            { typeId: 100, division: 4, containerItemId: CONTAINER_ID, quantity: 20 },
        ]);
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
        expect(result).toHaveLength(0);
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

        const result = await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(prisma.stockLog.createMany).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
        expect(result).toEqual({ ok: false, reason: "토큰 없음(만료/미등록)" });
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
        const prisma = {
            stockLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        const result = await syncStructure({
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
                    division: 1,
                    containerName: null,
                    quantity: 7,
                }),
            ],
        });
        expect(result).toEqual({ ok: true, itemTypes: 1 });
    });

    test("division 전체 제외 규칙이 있으면 그 division 아이템은 기록하지 않는다", async () => {
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
        const prisma = {
            stockLog: { createMany: jest.fn() },
            stockDivisionRule: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([{ division: 1, containerName: null, tracked: false }]),
            },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        const result = await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(prisma.stockLog.createMany).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: true, itemTypes: 0 });
    });

    test("이름 붙은 컨테이너 안 아이템은 ESI로 이름을 조회해 tracked:true 규칙과 매칭한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const CONTAINER_ID = 999;
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return {
                    ok: true,
                    json: async () => [{ item_id: CONTAINER_ID, name: "드론" }],
                };
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: CONTAINER_ID,
                        type_id: 3465,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG4",
                        quantity: 1,
                    },
                    {
                        item_id: 5001,
                        type_id: 12058,
                        location_id: CONTAINER_ID,
                        location_flag: "Unlocked",
                        quantity: 3,
                    },
                ],
            };
        });
        const prisma = {
            stockLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
            stockDivisionRule: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([{ division: 4, containerName: "드론", tracked: true }]),
            },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        const result = await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        // 컨테이너 자체(type_id=3465)는 containerName이 없어서 division 기본 규칙(추적함)으로 통과.
        // 안의 드론(type_id=12058)은 "드론" 컨테이너 규칙이 tracked:true라서 통과.
        expect(prisma.stockLog.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({ typeId: 3465, division: 4, containerName: null }),
                expect.objectContaining({ typeId: 12058, division: 4, containerName: "드론" }),
            ]),
        });
        expect(result).toEqual({ ok: true, itemTypes: 2 });
    });

    test("콥 자산 조회가 실패하면(non-ok) StockLog를 기록하지 않는다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async () => ({ ok: false, status: 403 }));
        const prisma = { stockLog: { createMany: jest.fn() } };
        const log = { info: jest.fn(), warn: jest.fn() };

        const result = await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(prisma.stockLog.createMany).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
        expect(result).toEqual({ ok: false, reason: "콥 자산 조회 실패" });
    });
});
