// packages/master/tests/tenantChannelMap.test.js
import { describe, expect, test, beforeEach, jest } from "@jest/globals";

describe("master/config/tenantChannelMap", () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test("DISCORD_TENANT_MAP 빈 값 → 빈 Map", async () => {
        process.env.DISCORD_TENANT_MAP = "";
        const { getTenantChannelMap, resolveTenantKey } =
            await import("../src/config/tenantChannelMap.js");
        const map = getTenantChannelMap();
        expect(map.size).toBe(0);
        expect(resolveTenantKey("any")).toBeNull();
    });

    test("유효한 포맷 channelId:tenantKey → Map 반환", async () => {
        process.env.DISCORD_TENANT_MAP = "1462754270406377482:CAT,1462754292573278218:FISH";
        const { getTenantChannelMap, resolveTenantKey } =
            await import("../src/config/tenantChannelMap.js");
        const map = getTenantChannelMap();
        expect(map.size).toBe(2);
        expect(map.get("1462754270406377482")).toBe("CAT");
        expect(map.get("1462754292573278218")).toBe("FISH");
        expect(resolveTenantKey("1462754270406377482")).toBe("CAT");
        expect(resolveTenantKey("unknown")).toBeNull();
    });

    test("형식 이상 항목은 스킵", async () => {
        process.env.DISCORD_TENANT_MAP = "c1:CAT,nocolon,c2:FISH";
        const { getTenantChannelMap } = await import("../src/config/tenantChannelMap.js");
        const map = getTenantChannelMap();
        expect(map.get("c1")).toBe("CAT");
        expect(map.get("c2")).toBe("FISH");
        expect(map.size).toBe(2);
    });
});
