// packages/worker/tests/fleet.test.js
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
    findBoss,
    getCharacterFleet,
    getFleetMembers,
    resolveNames,
    setFleetMemberRole,
} from "../src/esi/fleet.js";

const ESI_BASE = "https://esi.evetech.net/latest";

describe("worker/esi/fleet getCharacterFleet", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("404 → null", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 404,
            ok: false,
            text: () => Promise.resolve(""),
        });
        const result = await getCharacterFleet("token", 12345);
        expect(result).toBeNull();
    });

    test("!res.ok → null", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 403,
            ok: false,
            text: () => Promise.resolve("Forbidden"),
        });
        const result = await getCharacterFleet("token", 12345);
        expect(result).toBeNull();
    });

    test("200 + JSON body → 파싱 객체 반환", async () => {
        const body = {
            fleet_id: 999,
            role: "squad_member",
            squad_id: 1,
            wing_id: 2,
            fleet_boss_id: 111,
        };
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 200,
            ok: true,
            text: () => Promise.resolve(JSON.stringify(body)),
        });
        const result = await getCharacterFleet("bearer-token", 12345);
        expect(result).toEqual(body);
        expect(globalThis.fetch).toHaveBeenCalledWith(`${ESI_BASE}/characters/12345/fleet/`, {
            method: "GET",
            headers: { Authorization: "Bearer bearer-token" },
        });
    });
});

describe("worker/esi/fleet getFleetMembers", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("!res.ok → null", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 403,
            ok: false,
            text: () => Promise.resolve(""),
        });
        const result = await getFleetMembers("token", 999);
        expect(result).toBeNull();
    });

    test("200 + JSON 배열 → 배열 반환", async () => {
        const members = [
            { character_id: 1, role: "fleet_commander", role_name: "Fleet Commander (Boss)" },
            { character_id: 2, role: "squad_member", role_name: "Squad Member" },
        ];
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 200,
            ok: true,
            text: () => Promise.resolve(JSON.stringify(members)),
        });
        const result = await getFleetMembers("token", 999);
        expect(result).toEqual(members);
        expect(globalThis.fetch).toHaveBeenCalledWith(`${ESI_BASE}/fleets/999/members/`, {
            method: "GET",
            headers: { Authorization: "Bearer token" },
        });
    });
});

describe("worker/esi/fleet findBoss", () => {
    test("role_name에 (Boss) 포함 멤버 있음 → 객체 반환", () => {
        const members = [
            { character_id: 100, role: "squad_member", role_name: "Squad Member" },
            { character_id: 200, role: "fleet_commander", role_name: "Fleet Commander (Boss)" },
        ];
        const result = findBoss(members);
        expect(result).toEqual({
            bossCharacterId: 200,
            bossRole: "fleet_commander",
            bossRoleName: "Fleet Commander (Boss)",
        });
    });

    test("(Boss) 없음 → null", () => {
        const members = [{ character_id: 1, role: "squad_member", role_name: "Squad Member" }];
        expect(findBoss(members)).toBeNull();
    });

    test("배열 아님 → null", () => {
        expect(findBoss(null)).toBeNull();
        expect(findBoss({})).toBeNull();
    });
});

describe("worker/esi/fleet setFleetMemberRole", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("204 → ok: true, status", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 204,
            ok: true,
            text: () => Promise.resolve(""),
        });
        const result = await setFleetMemberRole("token", 999, 123, {
            role: "fleet_commander",
        });
        expect(result).toEqual({ ok: true, status: 204 });
    });

    test("res.ok true → ok: true", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 200,
            ok: true,
            text: () => Promise.resolve(""),
        });
        const result = await setFleetMemberRole("token", 999, 123, {
            role: "squad_member",
            wing_id: 1,
            squad_id: 2,
        });
        expect(result).toEqual({ ok: true, status: 200 });
    });

    test("4xx/5xx → ok: false, status, error", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 422,
            ok: false,
            text: () => Promise.resolve("validation error"),
        });
        const result = await setFleetMemberRole("token", 999, 123, {
            role: "fleet_commander",
        });
        expect(result).toEqual({
            ok: false,
            status: 422,
            error: "validation error",
        });
    });
});

describe("worker/esi/fleet resolveNames", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("빈 배열 ids → []", async () => {
        const result = await resolveNames([]);
        expect(result).toEqual([]);
    });

    test("200 + JSON 배열 → 해당 배열 반환", async () => {
        const names = [
            { category: "character", id: 1, name: "Alice" },
            { category: "character", id: 2, name: "Bob" },
        ];
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 200,
            ok: true,
            text: () => Promise.resolve(JSON.stringify(names)),
        });
        const result = await resolveNames([1, 2]);
        expect(result).toEqual(names);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${ESI_BASE}/universe/names/`,
            expect.objectContaining({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "[1,2]",
            })
        );
    });

    test("!res.ok → []", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 500,
            ok: false,
            text: () => Promise.resolve(""),
        });
        const result = await resolveNames([1]);
        expect(result).toEqual([]);
    });
});
