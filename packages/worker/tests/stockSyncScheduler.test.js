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
            itemId: null,
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
            itemId: null,
        });
        // 그 안의 탄약(type_id=21896)은 컨테이너(item_id=999) 소속으로 집계된다.
        expect(find(result, 21896)).toEqual({
            typeId: 21896,
            division: 4,
            containerItemId: CONTAINER_ID,
            quantity: 500,
            itemId: null,
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
            { typeId: 100, division: 3, containerItemId: null, quantity: 10, itemId: null },
            { typeId: 100, division: 4, containerItemId: CONTAINER_ID, quantity: 20, itemId: null },
        ]);
    });

    // 회귀 테스트: 실측(자산진단 명령)으로 확인됨 — division 밑에 이름 붙은 컨테이너가
    // 한 단계 더 감싸여 있는(2단 중첩) 실제 콥행어 케이스. 안쪽 아이템은 가장 바깥
    // 컨테이너가 아니라 자기 바로 위(진짜 부모) 컨테이너의 item_id를 받아야 한다 —
    // 안 그러면 그 이름으로 조회했을 때 엉뚱한(바깥) 컨테이너 이름이 나와서
    // StockDivisionRule 매칭이 조용히 실패한다(재고가 통째로 안 잡힘).
    test("컨테이너 안에 또 컨테이너가 있는 2단 중첩도 가장 안쪽 부모의 item_id를 받는다", () => {
        const OUTER_ID = 900; // division에 직접 있는 바깥 컨테이너(예: 기본 이름 그대로인 폴더)
        const INNER_ID = 901; // 바깥 컨테이너 안의 "PI" 같은 이름 붙은 안쪽 컨테이너
        const assets = [
            {
                item_id: OUTER_ID,
                type_id: 3465,
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG4",
                quantity: 1,
            },
            {
                item_id: INNER_ID,
                type_id: 3466, // "PI" 컨테이너 자체
                location_id: OUTER_ID,
                location_flag: "Unlocked", // 바깥 컨테이너 안에 있어서 CorpSAG 플래그가 없다
                quantity: 1,
            },
            {
                item_id: 5002,
                type_id: 3683, // PI 자재
                location_id: INNER_ID,
                location_flag: "Unlocked",
                quantity: 250,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);

        // 바깥 컨테이너 자체는 division에 직접 있으니 containerItemId가 없다.
        expect(find(result, 3465)).toEqual({
            typeId: 3465,
            division: 4,
            containerItemId: null,
            quantity: 1,
            itemId: null,
        });
        // 안쪽 컨테이너("PI") 자체는 바깥 컨테이너 소속이다.
        expect(find(result, 3466)).toEqual({
            typeId: 3466,
            division: 4,
            containerItemId: OUTER_ID,
            quantity: 1,
            itemId: null,
        });
        // PI 자재는 바로 위 부모인 INNER_ID("PI") 소속이어야 한다 — OUTER_ID가 아니다.
        expect(find(result, 3683)).toEqual({
            typeId: 3683,
            division: 4,
            containerItemId: INNER_ID,
            quantity: 250,
            itemId: null,
        });
    });

    // 회귀 테스트: 같은 타입(typeId)의 함선(is_singleton:true) 두 대가 같은 컨테이너에
    // 있어도, 이름을 아직 모르는 이 단계에서는 서로 다른 인스턴스로 남아야 한다 —
    // 안 그러면 나중에 커스텀명이 다를 때 이미 하나로 뭉쳐진 수량을 못 쪼갠다.
    test("같은 typeId 함선(is_singleton) 두 대는 인스턴스별로 따로 집계된다", () => {
        const SHIP_A_ID = 7001;
        const SHIP_B_ID = 7002;
        const assets = [
            {
                item_id: SHIP_A_ID,
                type_id: 22456, // Sabre
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG3",
                quantity: 1,
                is_singleton: true,
            },
            {
                item_id: SHIP_B_ID,
                type_id: 22456,
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG3",
                quantity: 1,
                is_singleton: true,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);
        const ships = result.filter((r) => r.typeId === 22456);
        expect(ships).toHaveLength(2);
        expect(ships).toEqual(
            expect.arrayContaining([
                {
                    typeId: 22456,
                    division: 3,
                    containerItemId: null,
                    quantity: 1,
                    itemId: SHIP_A_ID,
                },
                {
                    typeId: 22456,
                    division: 3,
                    containerItemId: null,
                    quantity: 1,
                    itemId: SHIP_B_ID,
                },
            ])
        );
    });

    // 회귀 테스트: is_singleton이 아닌(소모품) 아이템은 함선 로직이 섞여 들어와도
    // 기존처럼 그대로 합산돼야 한다 — item_id를 실수로라도 키에 넣으면 안 된다.
    test("is_singleton이 아닌 소모품은 여러 item_id라도 그대로 합산된다(회귀)", () => {
        const assets = [
            {
                item_id: 1,
                type_id: 300,
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG3",
                quantity: 10,
                is_singleton: false,
            },
            {
                item_id: 2,
                type_id: 300,
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG3",
                quantity: 5,
                is_singleton: false,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);
        expect(find(result, 300)).toEqual({
            typeId: 300,
            division: 3,
            containerItemId: null,
            quantity: 15,
            itemId: null,
        });
    });

    // 회귀 테스트: 실제로 겪은 버그 — 행어 안 함선에 장착된 모듈/화물(HiSlot·Cargo
    // 등)도 is_singleton:true라 예전엔 itemId로 잡혀서 getAssetNames 조회 대상에
    // 섞여 들어갔다. ESI는 이름 지정 불가 아이템이 하나라도 섞인 배치를 통째로
    // 404로 거부해서, 같은 청크에 우연히 묶인 다른 함선들까지 전부 이름을 잃었다
    // (재시도해도 똑같은 요청이라 안 고쳐짐 — 실제 프로덕션에서 이렇게 겪음). 함선
    // 자신은 정상 집계되고, 장착된 모듈/화물은 집계 결과에 아예 안 잡혀야 한다.
    test("행어 안 함선에 장착된 모듈/화물은 집계 대상에서 빠진다(포함되면 이름 조회 배치가 오염됨)", () => {
        const SHIP_ID = 9001;
        const FITTED_GUN_ID = 9002;
        const CARGO_AMMO_ID = 9003;
        const assets = [
            {
                item_id: SHIP_ID,
                type_id: 22456, // Sabre
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG3",
                quantity: 1,
                is_singleton: true,
            },
            {
                // 장착된 무기 — is_singleton:true(개별 장비 인스턴스)지만 이름 지정 불가.
                item_id: FITTED_GUN_ID,
                type_id: 2929,
                location_id: SHIP_ID,
                location_flag: "HiSlot0",
                quantity: 1,
                is_singleton: true,
            },
            {
                // 화물칸 탄약 — 스택형(is_singleton:false)이지만 위치가 함선 내부.
                item_id: CARGO_AMMO_ID,
                type_id: 12608,
                location_id: SHIP_ID,
                location_flag: "Cargo",
                quantity: 50,
                is_singleton: false,
            },
        ];

        const result = aggregateHangarStock(STRUCTURE_ID, assets);

        // 함선 자신은 정상적으로 잡힌다.
        expect(find(result, 22456)).toEqual({
            typeId: 22456,
            division: 3,
            containerItemId: null,
            quantity: 1,
            itemId: SHIP_ID,
        });
        // 장착 모듈/화물은 결과에 아예 없어야 한다 — typeId 기준으로도, item_id
        // 기준으로도 어디에도 안 잡혀야(이름 조회 대상으로 새 나가지 않아야) 한다.
        expect(find(result, 2929)).toBeUndefined();
        expect(find(result, 12608)).toBeUndefined();
        expect(result.some((r) => r.itemId === FITTED_GUN_ID)).toBe(false);
    });

    // 회귀 테스트: 잠긴 보안 컨테이너(Audit Log Secure Container 등) 안 내용물은
    // Unlocked가 아니라 Locked로 나온다 — 이것도 "장착 슬롯"이 아니라 정당한
    // 컨테이너 내용물이라 집계에 그대로 잡혀야 한다(Unlocked만 허용하던 첫 버전은
    // 이걸 놓쳐서 실제 재고를 조용히 빠뜨릴 뻔했다).
    test("잠긴 컨테이너(Locked) 내용물도 Unlocked와 동일하게 집계된다", () => {
        const CONTAINER_ID = 999;
        const assets = [
            {
                item_id: CONTAINER_ID,
                type_id: 17364, // Audit Log Secure Container
                location_id: STRUCTURE_ID,
                location_flag: "CorpSAG4",
                quantity: 1,
            },
            {
                item_id: 5001,
                type_id: 21896,
                location_id: CONTAINER_ID,
                location_flag: "Locked",
                quantity: 300,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);
        expect(find(result, 21896)).toEqual({
            typeId: 21896,
            division: 4,
            containerItemId: CONTAINER_ID,
            quantity: 300,
            itemId: null,
        });
    });

    // 회귀 테스트: division을 아직 못 찾은 채로 중간 경유 아이템이 2단 이상 이어지는
    // 경우 — division=null인 동안은 flag 가드를 걸면 안 된다(걸면 진짜 행어까지
    // 못 내려감). 이 파일 위쪽의 "행어 안 컨테이너 내용물은..." 테스트는 중간 경유가
    // 1단(오피스)뿐이라 이 문제를 못 잡는다 — 여기서는 오피스 안에 또 다른 이름 없는
    // 중간 아이템(예: 서브 폴더)이 한 번 더 끼는 2단 경유를 재현한다.
    test("division 확정 전 중간 경유가 2단 이상이어도 끝까지 내려가 행어에 도달한다", () => {
        const OFFICE_ID = 500;
        const SUB_FOLDER_ID = 501; // 오피스 안의, division도 CorpSAG도 아닌 또 다른 중간 아이템
        const assets = [
            {
                item_id: OFFICE_ID,
                type_id: 27,
                location_id: STRUCTURE_ID,
                location_flag: "OfficeFolder",
                quantity: 1,
            },
            {
                // "장착 슬롯도, Unlocked/Locked도 아닌" 임의의 중간 flag — division이
                // 아직 null이라 걸러지면 안 되는 경우를 흉내낸다.
                item_id: SUB_FOLDER_ID,
                type_id: 27,
                location_id: OFFICE_ID,
                location_flag: "SomeIntermediateFlag",
                quantity: 1,
            },
            {
                item_id: 5002,
                type_id: 100,
                location_id: SUB_FOLDER_ID,
                location_flag: "CorpSAG5",
                quantity: 7,
            },
        ];
        const result = aggregateHangarStock(STRUCTURE_ID, assets);
        expect(find(result, 100)).toEqual({
            typeId: 100,
            division: 5,
            containerItemId: null,
            quantity: 7,
            itemId: null,
        });
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
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
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
            stockLog: {
                createMany: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([{ division: 1, containerName: "", tracked: false }]),
            },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
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
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([{ division: 4, containerName: "드론", tracked: true }]),
            },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
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

    test("같은 이름의 함선 2대는 이름을 조회한 뒤 하나로 합쳐 기록된다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const SHIP_A_ID = 7001;
        const SHIP_B_ID = 7002;
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return {
                    ok: true,
                    json: async () => [
                        { item_id: SHIP_A_ID, name: "ฅ^•ﻌ•^ฅ에태클" },
                        { item_id: SHIP_B_ID, name: "ฅ^•ﻌ•^ฅ에태클" },
                    ],
                };
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: SHIP_A_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                    {
                        item_id: SHIP_B_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                ],
            };
        });
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
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
                    typeId: 22456,
                    itemName: "ฅ^•ﻌ•^ฅ에태클",
                    quantity: 2,
                }),
            ],
        });
        expect(result).toEqual({ ok: true, itemTypes: 1 });
    });

    test("다른 이름의 함선 2대는 각자 별도 행으로 기록된다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const SHIP_A_ID = 7001;
        const SHIP_B_ID = 7002;
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return {
                    ok: true,
                    json: async () => [
                        { item_id: SHIP_A_ID, name: "ฅ^•ﻌ•^ฅ에태클" },
                        { item_id: SHIP_B_ID, name: "특수임무용" },
                    ],
                };
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: SHIP_A_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                    {
                        item_id: SHIP_B_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                ],
            };
        });
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        const result = await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(prisma.stockLog.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({
                    typeId: 22456,
                    itemName: "ฅ^•ﻌ•^ฅ에태클",
                    quantity: 1,
                }),
                expect.objectContaining({ typeId: 22456, itemName: "특수임무용", quantity: 1 }),
            ]),
        });
        expect(result).toEqual({ ok: true, itemTypes: 2 });
    });

    test("이름 없는(한 번도 안 바꾼) 함선 2대는 typeId 기준으로 합쳐진다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const SHIP_A_ID = 7001;
        const SHIP_B_ID = 7002;
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return { ok: true, json: async () => [] }; // 이름 응답 없음(둘 다 미지정)
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: SHIP_A_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                    {
                        item_id: SHIP_B_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                ],
            };
        });
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        const result = await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(prisma.stockLog.createMany).toHaveBeenCalledWith({
            data: [expect.objectContaining({ typeId: 22456, itemName: null, quantity: 2 })],
        });
        expect(result).toEqual({ ok: true, itemTypes: 1 });
    });

    test("getAssetNames를 컨테이너·함선 id를 합쳐 한 번만 호출한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const CONTAINER_ID = 999;
        const SHIP_ID = 7001;
        const namesCalls = [];
        global.fetch = jest.fn(async (url, opts) => {
            if (String(url).includes("/assets/names/")) {
                namesCalls.push(JSON.parse(opts.body));
                return { ok: true, json: async () => [] };
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
                        type_id: 21896,
                        location_id: CONTAINER_ID,
                        location_flag: "Unlocked",
                        quantity: 500,
                    },
                    {
                        item_id: SHIP_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                ],
            };
        });
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(namesCalls).toHaveLength(1);
        expect(namesCalls[0].sort()).toEqual([CONTAINER_ID, SHIP_ID].sort());
    });

    // 목표 없는(이름 있는) 함선은 이력을 안 쌓는다 — 매 사이클마다 예전 기록을 지우고
    // 새로 쓴다. 실수로 잘못된 이름을 넣었다가 고쳐도 옛날 잘못된 이름이 30일 창
    // 안에서 유령처럼 계속 보이는 걸 막기 위함(사용자 확인).
    test("목표 없는 함선은 동기화 전에 그 (typeId, itemName)의 옛 기록을 지운다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const SHIP_ID = 7001;
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return { ok: true, json: async () => [{ item_id: SHIP_ID, name: "에태클" }] };
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: SHIP_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                ],
            };
        });
        const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                // 예전에 잘못 지은 이름("애태클", 오타)으로 이미 쌓여 있던 기록.
                findMany: jest.fn().mockResolvedValue([{ typeId: 22456, itemName: "애태클" }]),
                deleteMany,
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) }, // 목표 없음
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(deleteMany).toHaveBeenCalledWith({
            where: {
                structureId: STRUCTURE_ID,
                OR: [{ typeId: 22456, itemName: "애태클" }],
            },
        });
    });

    // 회귀 테스트: 실제로 겪은 사고 — 이름 조회가 일시적으로 실패해서 진짜 존재하는
    // 함선이 이번 사이클에만 itemName:null로 잡히면, 예전 정리 로직은 "이번엔 안
    // 나타났다"고 오판해서 그 함선의 30일 이력을 영구 삭제했다. getAssetNames가
    // hadFailures를 알려주면 그 사이클은 정리 자체를 건너뛰어야 한다 — 위 테스트와
    // 완전히 같은 "옛 이름 기록이 이번엔 안 보임" 상황이지만, 이번엔 이름 조회
    // 자체가 실패한 게 원인이라 지우면 안 된다.
    test("이름 조회가 실패한 사이클엔 유령 정리를 건너뛴다(진짜 함선 이력을 잘못 지우지 않기 위해)", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const SHIP_ID = 7001;
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                // 재시도까지 계속 실패 — 이 함선의 이름을 이번엔 못 구함.
                return { ok: false, status: 500 };
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: SHIP_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                ],
            };
        });
        const deleteMany = jest.fn();
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                // 예전에 정상적으로 붙어 있던 이름 — 이번 사이클엔 이름 조회 실패로
                // itemName:null로 동기화되니, 정리 로직 관점에선 "이번엔 없다"로
                // 보일 수 있는 상황이다.
                findMany: jest.fn().mockResolvedValue([{ typeId: 22456, itemName: "에태클" }]),
                deleteMany,
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        // 이름 조회가 실패했다는 warn은 남기되, 파괴적인 정리(deleteMany)는 전혀
        // 호출되지 않아야 한다 — 다음(성공하는) 사이클에서 지워도 늦지 않다.
        expect(deleteMany).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });

    test("목표가 있는 함선은 옛 기록을 안 지우고 그대로 누적한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const SHIP_ID = 7001;
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return { ok: true, json: async () => [{ item_id: SHIP_ID, name: "에태클" }] };
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: SHIP_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                ],
            };
        });
        const deleteMany = jest.fn();
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                // itemName:null 조회(미조립 함선 유령 정리용)와 itemName:{not:null}
                // 조회(이름 있는 함선 정리용)를 where로 구분해야 한다 — 안 그러면 같은
                // 캔 값이 null 조회에도 그대로 나가서 실제로 없는 미조립 유령이 있는
                // 것처럼 잘못 감지된다.
                findMany: jest.fn().mockImplementation((args) => {
                    if (args?.where?.itemName === null) return Promise.resolve([]);
                    return Promise.resolve([{ typeId: 22456, itemName: "에태클" }]);
                }),
                deleteMany,
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: {
                // "에태클"에 목표가 잡혀 있음 — 지금 동기화되는 이름과 동일.
                findMany: jest
                    .fn()
                    .mockResolvedValue([{ typeId: 22456, itemName: "에태클", targetQty: 3 }]),
            },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(deleteMany).not.toHaveBeenCalled();
    });

    test("현재 사이클에 안 나타나는(이름 바뀌었거나 사라진) 목표 없는 함선 유령 기록도 지운다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return { ok: true, json: async () => [] };
            }
            return { ok: true, headers: { get: () => "1" }, json: async () => [] }; // 이번엔 자산 자체가 없음
        });
        const deleteMany = jest.fn().mockResolvedValue({ count: 5 });
        const prisma = {
            stockLog: {
                createMany: jest.fn(),
                // DB에는 예전에 있었지만 이번 사이클엔 안 잡히는 함선(팔았거나 옮겨짐).
                findMany: jest.fn().mockResolvedValue([{ typeId: 22456, itemName: "예전함선" }]),
                deleteMany,
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(deleteMany).toHaveBeenCalledWith({
            where: {
                structureId: STRUCTURE_ID,
                OR: [{ typeId: 22456, itemName: "예전함선" }],
            },
        });
    });

    // 회귀 테스트: 조립 안 된(itemName=null) 함선이 조립돼서 이름이 붙으면, 그
    // typeId의 옛 null 기록도 유령으로 지워져야 한다 — 실측으로 겪은 버그(조립된 지
    // 3일이 지나도 미조립 1대가 계속 "현재 재고"에 남아있던 문제)의 회귀 테스트.
    test("미조립 함선이 조립되면 그 typeId의 옛 itemName=null 유령 기록을 지운다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const SHIP_ID = 7001;
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return { ok: true, json: async () => [{ item_id: SHIP_ID, name: "새함선" }] };
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: SHIP_ID,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: true,
                    },
                ],
            };
        });
        const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                findMany: jest.fn().mockImplementation((args) => {
                    if (args?.where?.itemName === null) {
                        // 예전에(미조립일 때) 이 typeId로 남긴 null 기록.
                        return Promise.resolve([{ typeId: 22456 }]);
                    }
                    // 이름 붙은 기록은 이번이 처음이라 DB엔 아직 없음.
                    return Promise.resolve([]);
                }),
                deleteMany,
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(deleteMany).toHaveBeenCalledWith({
            where: {
                structureId: STRUCTURE_ID,
                itemName: null,
                typeId: { in: [22456] },
            },
        });
    });

    test("여전히 미조립 상태로 남아있는 함선은 null 기록을 안 지운다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/assets/names/")) {
                return { ok: true, json: async () => [] }; // 여전히 이름 없음
            }
            return {
                ok: true,
                headers: { get: () => "1" },
                json: async () => [
                    {
                        item_id: 7001,
                        type_id: 22456,
                        location_id: STRUCTURE_ID,
                        location_flag: "CorpSAG3",
                        quantity: 1,
                        is_singleton: false, // 계속 미조립
                    },
                ],
            };
        });
        const deleteMany = jest.fn();
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                findMany: jest.fn().mockImplementation((args) => {
                    // 예전에 이름 붙은 적이 있어서(같은 typeId) null 정리 대상 후보에는
                    // 든다 — 하지만 이번 사이클에도 여전히 null로 나타나므로 지우면 안 됨.
                    if (args?.where?.itemName === null) return Promise.resolve([{ typeId: 22456 }]);
                    return Promise.resolve([{ typeId: 22456, itemName: "예전이름" }]);
                }),
                deleteMany,
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        // 이름 있는 쪽("예전이름")은 이번 사이클에 없으니 지워지지만, null 쪽은
        // 여전히 현재 상태라 지워지면 안 된다 — 두 delete가 서로 섞이지 않는지 확인.
        expect(deleteMany).toHaveBeenCalledTimes(1);
        expect(deleteMany).toHaveBeenCalledWith({
            where: {
                structureId: STRUCTURE_ID,
                OR: [{ typeId: 22456, itemName: "예전이름" }],
            },
        });
    });

    // 회귀 테스트: 일반 소모품(탄약 등)은 이름 붙은 적이 아예 없으므로, 이번
    // 사이클에 안 나타나도(다 써서 없어짐 등) null 정리 로직이 안 건드려야 한다 —
    // "이름 붙은 적 있는 typeId만" 정리 대상이라는 스코프를 확인한다.
    test("이름 붙은 적 없는 일반 소모품 typeId는 null 정리 대상에서 제외된다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: { get: () => "1" },
            json: async () => [], // 이번 사이클엔 이 typeId가 아예 안 나타남(다 소진됨)
        }));
        const deleteMany = jest.fn();
        const prisma = {
            stockLog: {
                createMany: jest.fn(),
                findMany: jest.fn().mockImplementation((args) => {
                    // 이름 붙은 기록은 이 구조물에 전혀 없다 — 순수 소모품만 있던 상태.
                    if (args?.where?.itemName === null) return Promise.resolve([{ typeId: 34 }]);
                    return Promise.resolve([]);
                }),
                deleteMany,
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        // shipTypeIds가 비어있으니(이름 붙은 적 있는 typeId가 없음) null 정리
        // 쿼리 자체를 안 날린다 — findMany가 itemName:null where로 호출되지 않는다.
        expect(
            prisma.stockLog.findMany.mock.calls.some((c) => c[0]?.where?.itemName === null)
        ).toBe(false);
        expect(deleteMany).not.toHaveBeenCalled();
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

// 회귀 테스트: ESI Expires 헤더 기반 다음 동기화 시각 계산(scheduleNext)은
// 내부 함수라 직접 export되지 않는다 — syncStructure를 통해 그 부수효과
// (TrackedStructure.update 호출 인자)로 관측한다. 이전엔 이 파일의 어떤
// 테스트도 prisma.trackedStructure를 안 모킹해서, 모든 테스트가 scheduleNext의
// DB 기록 실패(catch로 조용히 삼켜짐) 분기만 우연히 타고 있었다 — due-time
// 계산 자체는 사실상 한 번도 검증된 적이 없었다.
describe("stockSyncScheduler/syncStructure → scheduleNext(다음 동기화 시각)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("응답 Expires 헤더가 있으면 그 값+10초 여유로 nextSyncAt을 기록한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30분 뒤(임의)
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: { get: (name) => (name === "expires" ? expiresAt.toUTCString() : "1") },
            json: async () => [],
        }));
        const update = jest.fn().mockResolvedValue({});
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            trackedStructure: { update },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(update).toHaveBeenCalledTimes(1);
        const call = update.mock.calls[0][0];
        expect(call.where).toEqual({ structureId: STRUCTURE_ID });
        // HTTP-date는 초 단위 정밀도라, Date.parse 왕복에서 최대 1초 오차가 생길 수 있다.
        expect(
            Math.abs(call.data.nextSyncAt.getTime() - (expiresAt.getTime() + 10_000))
        ).toBeLessThan(1_500);
    });

    test("Expires 헤더가 없으면 1시간 뒤로 폴백한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: { get: () => null },
            json: async () => [],
        }));
        const update = jest.fn().mockResolvedValue({});
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            trackedStructure: { update },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        const before = Date.now();
        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(update).toHaveBeenCalledTimes(1);
        const nextSyncAt = update.mock.calls[0][0].data.nextSyncAt.getTime();
        expect(nextSyncAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1_000);
        expect(nextSyncAt).toBeLessThanOrEqual(before + 60 * 60 * 1000 + 5_000);
    });

    test("토큰이 없어도 1시간 뒤 폴백으로 nextSyncAt을 기록한다(다음 tick에서 재시도되게)", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue(null);
        const update = jest.fn().mockResolvedValue({});
        const prisma = { trackedStructure: { update } };
        const log = { info: jest.fn(), warn: jest.fn() };

        const before = Date.now();
        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(update).toHaveBeenCalledWith({
            where: { structureId: STRUCTURE_ID },
            data: { nextSyncAt: expect.any(Date) },
        });
        const nextSyncAt = update.mock.calls[0][0].data.nextSyncAt.getTime();
        expect(nextSyncAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1_000);
    });

    test("콥 자산 조회가 재시도까지 실패해도 1시간 뒤 폴백으로 nextSyncAt을 기록한다", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
        const update = jest.fn().mockResolvedValue({});
        const prisma = { trackedStructure: { update } };
        const log = { info: jest.fn(), warn: jest.fn() };

        const before = Date.now();
        await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(update).toHaveBeenCalledTimes(1);
        const nextSyncAt = update.mock.calls[0][0].data.nextSyncAt.getTime();
        expect(nextSyncAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1_000);
    });

    test("trackedStructure.update이 실패해도(DB 오류) 예외를 던지지 않는다 — 스케줄링 자체는 인메모리로 이미 반영됐기 때문", async () => {
        mockGetAccessTokenForCharacter.mockResolvedValue("token-abc");
        global.fetch = jest.fn(async () => ({
            ok: true,
            headers: { get: () => null },
            json: async () => [],
        }));
        const prisma = {
            stockLog: {
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
                findMany: jest.fn().mockResolvedValue([]),
                deleteMany: jest.fn(),
            },
            stockDivisionRule: { findMany: jest.fn().mockResolvedValue([]) },
            stockTarget: { findMany: jest.fn().mockResolvedValue([]) },
            trackedStructure: { update: jest.fn().mockRejectedValue(new Error("DB down")) },
        };
        const log = { info: jest.fn(), warn: jest.fn() };

        const result = await syncStructure({
            prisma,
            structure: { structureId: STRUCTURE_ID, corporationId: 98641311 },
            anchorCharacterId: 2115893596n,
            log,
        });

        expect(result).toEqual({ ok: true, itemTypes: 0 });
    });
});
