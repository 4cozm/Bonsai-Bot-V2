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

    test("일부 청크가 실패해도 나머지 결과는 유지한다", async () => {
        let call = 0;
        globalThis.fetch = jest.fn().mockImplementation(() => {
            call += 1;
            if (call === 1) return Promise.resolve({ ok: false, status: 420 });
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve([{ item_id: 999, name: "PVP" }]),
            });
        });
        const ids = Array.from({ length: 250 }, (_, i) => i + 1);

        const result = await getAssetNames("token", 12345, ids);

        expect(result.get(999)).toBe("PVP");
        expect(result.size).toBe(1);
    });

    test("fetch가 throw해도 예외를 던지지 않고 빈 결과로 처리한다", async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new Error("network error"));
        const result = await getAssetNames("token", 12345, [1]);
        expect(result.size).toBe(0);
    });
});
