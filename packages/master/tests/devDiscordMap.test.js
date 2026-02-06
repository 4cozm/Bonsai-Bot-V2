// packages/master/tests/devDiscordMap.test.js
import { describe, expect, test, beforeEach, jest } from "@jest/globals";

describe("master/config/devDiscordMap", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test("DEV_DISCORD_MAP 빈 값 → 빈 Map", async () => {
        process.env.DEV_DISCORD_MAP = "";
        const { getDevDiscordMap, resolveTargetDev } =
            await import("../src/config/devDiscordMap.js");
        const map = getDevDiscordMap();
        expect(map.size).toBe(0);
        expect(resolveTargetDev("any")).toBeNull();
    });

    test("유효한 포맷 discordId:targetDev → Map 반환", async () => {
        process.env.DEV_DISCORD_MAP = "339017884703653888:hasjun041215,378543198953406464:17328rm";
        const { getDevDiscordMap, resolveTargetDev } =
            await import("../src/config/devDiscordMap.js");
        const map = getDevDiscordMap();
        expect(map.size).toBe(2);
        expect(map.get("339017884703653888")).toBe("hasjun041215");
        expect(resolveTargetDev("339017884703653888")).toBe("hasjun041215");
        expect(resolveTargetDev("unknown")).toBeNull();
    });
});
