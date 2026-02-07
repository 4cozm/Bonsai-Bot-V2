// packages/worker/tests/getCorporationStructures.test.js
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { getCorporationStructures } from "../src/esi/getCorporationStructures.js";

describe("worker/esi/getCorporationStructures", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("accessToken 없음(빈 문자열) → null", async () => {
        const result = await getCorporationStructures("", 12345);
        expect(result).toBeNull();
    });

    test("accessToken null → null", async () => {
        const result = await getCorporationStructures(null, 12345);
        expect(result).toBeNull();
    });

    test("fetch 실패(throw) → null", async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new Error("network error"));
        const result = await getCorporationStructures("token", 12345);
        expect(result).toBeNull();
    });

    test("res.ok === false → null", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 403,
        });
        const result = await getCorporationStructures("token", 12345);
        expect(result).toBeNull();
    });

    test("res.ok === true, JSON 배열 반환 → 그대로 반환", async () => {
        const structures = [
            { structure_id: 1, type_id: 35832, name: "Citadel" },
            { structure_id: 2, type_id: 35835, name: "Athanor" },
        ];
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(structures),
        });

        const result = await getCorporationStructures("bearer-token", 98765);

        expect(result).toEqual(structures);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "https://esi.evetech.net/latest/corporations/98765/structures/",
            {
                method: "GET",
                headers: { Authorization: "Bearer bearer-token" },
            }
        );
    });
});
