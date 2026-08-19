// packages/worker/tests/getAssetNames.test.js
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { getAssetNames } from "../src/esi/getAssetNames.js";

describe("worker/esi/getAssetNames", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("accessToken 없음 → 빈 맵, fetch 안 부른다", async () => {
        globalThis.fetch = jest.fn();
        const result = await getAssetNames("", 12345, [1, 2]);
        expect(result.names.size).toBe(0);
        expect(result.hadFailures).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("itemIds 비어있음 → 빈 맵, fetch 안 부른다", async () => {
        globalThis.fetch = jest.fn();
        const result = await getAssetNames("token", 12345, []);
        expect(result.names.size).toBe(0);
        expect(result.hadFailures).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("정상 응답 → item_id -> name 맵으로 변환한다", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve([
                    { item_id: 1, name: "드론" },
                    { item_id: 2, name: "탄약" },
                ]),
        });

        const result = await getAssetNames("bearer-token", 98765, [1, 2]);

        expect(result.names.get(1)).toBe("드론");
        expect(result.names.get(2)).toBe("탄약");
        expect(result.hadFailures).toBe(false);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "https://esi.evetech.net/latest/corporations/98765/assets/names/",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({ Authorization: "Bearer bearer-token" }),
                body: JSON.stringify([1, 2]),
            })
        );
    });

    test("이름 없는(기본 이름) 항목은 결과 맵에서 빠진다", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([{ item_id: 1, name: "" }]),
        });
        const result = await getAssetNames("token", 12345, [1]);
        expect(result.names.has(1)).toBe(false);
        expect(result.hadFailures).toBe(false);
    });

    test("200개 넘으면 여러 번 청크로 나눠 호출하고 결과를 합친다", async () => {
        const ids = Array.from({ length: 250 }, (_, i) => i + 1);
        globalThis.fetch = jest.fn().mockImplementation((url, opts) => {
            const batch = JSON.parse(opts.body);
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve(batch.map((id) => ({ item_id: id, name: `name-${id}` }))),
            });
        });

        const result = await getAssetNames("token", 12345, ids);

        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        expect(result.names.size).toBe(250);
        expect(result.names.get(1)).toBe("name-1");
        expect(result.names.get(250)).toBe("name-250");
        expect(result.hadFailures).toBe(false);
    });

    test("한 청크가 재시도까지 다 실패해도 나머지 청크 결과는 유지한다 — hadFailures도 켜진다", async () => {
        globalThis.fetch = jest.fn().mockImplementation((url, opts) => {
            const batch = JSON.parse(opts.body);
            // id=1이 섞인 청크(1~200)는 모든 시도가 실패, 나머지 청크는 항상 성공.
            if (batch.includes(1)) {
                return Promise.resolve({ ok: false, status: 420 });
            }
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve(batch.map((id) => ({ item_id: id, name: `name-${id}` }))),
            });
        });
        const ids = Array.from({ length: 250 }, (_, i) => i + 1);

        const result = await getAssetNames("token", 12345, ids);

        expect(result.names.has(1)).toBe(false);
        expect(result.names.get(250)).toBe("name-250");
        expect(result.names.size).toBe(50);
        // 실패 청크: 최대 시도 횟수(3)만큼, 성공 청크: 1번 → 총 4번.
        expect(globalThis.fetch).toHaveBeenCalledTimes(4);
        // 호출부(syncStructure)가 이걸 보고 이번 사이클의 유령 정리를 건너뛴다 —
        // 부분 실패를 조용히 삼키지 않고 신호로 남긴다.
        expect(result.hadFailures).toBe(true);
    });

    // 회귀 테스트: 실제로 겪은 버그 — 배치에 이름 지정 불가한 id(청사진 사본 등,
    // 함선 장착 모듈 필터링으로도 못 거르는 케이스) 하나만 섞여도 ESI가 배치 전체를
    // 404로 거부했다. 재시도로는 절대 안 고쳐지는(똑같은 요청을 그대로 다시 보내는)
    // 실패라, 이분 탐색으로 문제 id를 찾아서 격리하고 나머지는 정상적으로 이름을
    // 받아야 한다.
    test("배치에 이름 지정 불가한 id가 하나 섞여도 이분 탐색으로 나머지는 정상 조회된다", async () => {
        const POISON_ID = 3;
        globalThis.fetch = jest.fn().mockImplementation((url, opts) => {
            const batch = JSON.parse(opts.body);
            if (batch.includes(POISON_ID)) {
                return Promise.resolve({ ok: false, status: 404 });
            }
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve(batch.map((id) => ({ item_id: id, name: `name-${id}` }))),
            });
        });

        const result = await getAssetNames("token", 12345, [1, 2, 3, 4]);

        expect(result.names.get(1)).toBe("name-1");
        expect(result.names.get(2)).toBe("name-2");
        expect(result.names.has(3)).toBe(false); // 이름 지정 불가 id — 조용히 빠짐
        expect(result.names.get(4)).toBe("name-4");
        // 이름 지정 불가 id 하나 때문에 정리 로직이 계속 막히면 안 되니, hadFailures는
        // 안 켜져야 한다 — 이건 재시도로 고칠 "실패"가 아니라 확정된 상태다.
        expect(result.hadFailures).toBe(false);
    });

    test("배치에 이름 지정 불가한 id가 여러 개 흩어져 있어도 전부 격리하고 나머지는 정상 조회된다", async () => {
        const POISON_IDS = new Set([2, 7]);
        globalThis.fetch = jest.fn().mockImplementation((url, opts) => {
            const batch = JSON.parse(opts.body);
            if (batch.some((id) => POISON_IDS.has(id))) {
                return Promise.resolve({ ok: false, status: 404 });
            }
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve(batch.map((id) => ({ item_id: id, name: `name-${id}` }))),
            });
        });

        const ids = [1, 2, 3, 4, 5, 6, 7, 8];
        const result = await getAssetNames("token", 12345, ids);

        for (const id of ids) {
            if (POISON_IDS.has(id)) {
                expect(result.names.has(id)).toBe(false);
            } else {
                expect(result.names.get(id)).toBe(`name-${id}`);
            }
        }
        expect(result.hadFailures).toBe(false);
    });

    test("404는 재시도 없이 바로 포기한다(재시도해도 똑같은 요청이라 의미가 없음)", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
        const result = await getAssetNames("token", 12345, [1]);
        expect(result.names.size).toBe(0);
        expect(result.hadFailures).toBe(false);
        // MAX_ATTEMPTS(3)만큼 재시도했다면 3번 불렸겠지만, 404는 1번만 부르고 포기한다.
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    test("첫 시도가 실패해도 재시도가 성공하면 결과에 포함된다 — 실제로 겪은 버그의 핵심", async () => {
        let attempts = 0;
        globalThis.fetch = jest.fn().mockImplementation(() => {
            attempts += 1;
            if (attempts === 1) return Promise.resolve({ ok: false, status: 500 });
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve([{ item_id: 1, name: "재시도로 성공" }]),
            });
        });

        const result = await getAssetNames("token", 12345, [1]);

        expect(result.names.get(1)).toBe("재시도로 성공");
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        // 결국 성공했으니 실패로 안 남는다.
        expect(result.hadFailures).toBe(false);
    });

    // 회귀 테스트: 재시도 1번(총 2번 시도)이던 시절엔 이 케이스에서 이름이
    // 누락됐다 — 관리자가 /자산진단을 무겁게 돌리는 동안 ESI 요청 제한에 두 번
    // 연속 걸릴 수 있다는 걸 실측으로 확인하고 최대 시도 횟수를 3으로 늘렸다.
    test("두 번 연속 실패해도 세 번째 시도에서 성공하면 결과에 포함된다", async () => {
        let attempts = 0;
        globalThis.fetch = jest.fn().mockImplementation(() => {
            attempts += 1;
            if (attempts <= 2) return Promise.resolve({ ok: false, status: 420 });
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve([{ item_id: 1, name: "세 번째 시도로 성공" }]),
            });
        });

        const result = await getAssetNames("token", 12345, [1]);

        expect(result.names.get(1)).toBe("세 번째 시도로 성공");
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
        expect(result.hadFailures).toBe(false);
    });

    test("fetch가 재시도까지 계속 throw해도 예외를 던지지 않고 빈 결과로 처리한다 — hadFailures가 켜진다", async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new Error("network error"));
        const result = await getAssetNames("token", 12345, [1]);
        expect(result.names.size).toBe(0);
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
        expect(result.hadFailures).toBe(true);
    });
});
