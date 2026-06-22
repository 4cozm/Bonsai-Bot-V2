// packages/worker/tests/pajamaEsiCalls.test.js
import { describe, expect, test } from "@jest/globals";
import { findCAImplantTypeId, getAllImplantsFromClones } from "../src/pajama/esiCalls.js";

// 잠옷 모니터에서 CA 임플란트 판별에 사용하는 순수 함수 테스트.
const CA_TYPE_IDS = [2082, 2589, 33393, 33394];

describe("worker/pajama/esiCalls/findCAImplantTypeId", () => {
    test("배열이 아니면 null (null/undefined/객체)", () => {
        expect(findCAImplantTypeId(null, CA_TYPE_IDS)).toBeNull();
        expect(findCAImplantTypeId(undefined, CA_TYPE_IDS)).toBeNull();
        expect(findCAImplantTypeId({}, CA_TYPE_IDS)).toBeNull();
    });

    test("빈 배열 → null", () => {
        expect(findCAImplantTypeId([], CA_TYPE_IDS)).toBeNull();
    });

    test("CA 임플란트 미보유 → null", () => {
        expect(findCAImplantTypeId([10000, 20000, 30000], CA_TYPE_IDS)).toBeNull();
    });

    test("CA 임플란트 단일 보유 → 해당 typeId 반환", () => {
        expect(findCAImplantTypeId([10000, 2589, 30000], CA_TYPE_IDS)).toBe(2589);
    });

    test("CA 여러 개 보유 → implantList 순서상 첫 번째 CA 반환", () => {
        expect(findCAImplantTypeId([33394, 2082], CA_TYPE_IDS)).toBe(33394);
    });

    test("문자열 typeId도 Number로 변환하여 매칭, 숫자로 반환", () => {
        const out = findCAImplantTypeId(["10000", "2082"], CA_TYPE_IDS);
        expect(out).toBe(2082);
        expect(typeof out).toBe("number");
    });

    test("caTypeIds가 비어 있으면 항상 null", () => {
        expect(findCAImplantTypeId([2082, 2589], [])).toBeNull();
    });
});

describe("worker/pajama/esiCalls/getAllImplantsFromClones", () => {
    test("null/undefined → []", () => {
        expect(getAllImplantsFromClones(null)).toEqual([]);
        expect(getAllImplantsFromClones(undefined)).toEqual([]);
    });

    test("jump_clones 키 없음 → []", () => {
        expect(getAllImplantsFromClones({})).toEqual([]);
    });

    test("jump_clones 빈 배열 → []", () => {
        expect(getAllImplantsFromClones({ jump_clones: [] })).toEqual([]);
    });

    test("여러 클론의 implants를 평탄화하여 반환", () => {
        const clonesData = {
            jump_clones: [
                { jump_clone_id: 1, implants: [2082, 100] },
                { jump_clone_id: 2, implants: [2589] },
            ],
        };
        expect(getAllImplantsFromClones(clonesData)).toEqual([2082, 100, 2589]);
    });

    test("implants 필드 없는 클론은 빈 배열로 처리 (skip)", () => {
        const clonesData = {
            jump_clones: [
                { jump_clone_id: 1 }, // implants 없음
                { jump_clone_id: 2, implants: [33393] },
            ],
        };
        expect(getAllImplantsFromClones(clonesData)).toEqual([33393]);
    });
});
