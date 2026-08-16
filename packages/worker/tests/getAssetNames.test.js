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
        expect(result.size).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("itemIds 비어있음 → 빈 맵, fetch 안 부른다", async () => {
        globalThis.fetch = jest.fn();
        const result = await getAssetNames("token", 12345, []);
        expect(result.size).toBe(0);
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

        expect(result.get(1)).toBe("드론");
        expect(result.get(2)).toBe("탄약");
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
        expect(result.has(1)).toBe(false);
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
        expect(result.size).toBe(250);
        expect(result.get(1)).toBe("name-1");
        expect(result.get(250)).toBe("name-250");
    });

    test("한 청크가 재시도까지 다 실패해도 나머지 청크 결과는 유지한다", async () => {
        globalThis.fetch = jest.fn().mockImplementation((url, opts) => {
            const batch = JSON.parse(opts.body);
            // id=1이 섞인 청크(1~200)는 원 요청·재시도 둘 다 실패, 나머지 청크는 항상 성공.
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

        expect(result.has(1)).toBe(false);
        expect(result.get(250)).toBe("name-250");
        expect(result.size).toBe(50);
        // 실패 청크: 원 요청 + 재시도 = 2번, 성공 청크: 1번 → 총 3번.
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
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

        expect(result.get(1)).toBe("재시도로 성공");
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    test("fetch가 재시도까지 계속 throw해도 예외를 던지지 않고 빈 결과로 처리한다", async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new Error("network error"));
        const result = await getAssetNames("token", 12345, [1]);
        expect(result.size).toBe(0);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
});
