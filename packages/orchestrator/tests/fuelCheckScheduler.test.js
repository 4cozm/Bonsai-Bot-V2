// packages/orchestrator/tests/fuelCheckScheduler.test.js
process.env.TZ = "Asia/Seoul";

import { expect, jest, test } from "@jest/globals";

jest.useFakeTimers();

const mockBuildCmdEnvelope = jest.fn((input) => ({
    id: `env-${input.tenantKey}`,
    type: "cmd",
    tenantKey: input.tenantKey,
    cmd: input.cmd,
    args: input.args ?? "",
    meta: input.meta ?? {},
}));
const mockPublishCmdToRedisStream = jest.fn().mockResolvedValue("entry-id");

await jest.unstable_mockModule("@bonsai/shared", () => ({
    buildCmdEnvelope: mockBuildCmdEnvelope,
    logger: () => ({ info: () => {}, warn: () => {} }),
    publishCmdToRedisStream: mockPublishCmdToRedisStream,
}));

const { startFuelCheckScheduler } = await import("../src/schedulers/fuelCheckScheduler.js");

const redis = {};

test("FUEL_CHECK_TENANT_KEYS 비어있음 → publishCmdToRedisStream 0회", async () => {
    const prev = process.env.FUEL_CHECK_TENANT_KEYS;
    process.env.FUEL_CHECK_TENANT_KEYS = "";
    try {
        await startFuelCheckScheduler({ redis, signal: new AbortController().signal });
        expect(mockPublishCmdToRedisStream).not.toHaveBeenCalled();
    } finally {
        if (prev !== undefined) process.env.FUEL_CHECK_TENANT_KEYS = prev;
        else delete process.env.FUEL_CHECK_TENANT_KEYS;
    }
});

test("FUEL_CHECK_TENANT_KEYS=CAT,FISH → 시간 진행 후 publishCmdToRedisStream 2회, envelope cmd·meta 검증", async () => {
    process.env.FUEL_CHECK_TENANT_KEYS = "CAT,FISH";
    process.env.DISCORD_TENANT_MAP = "ch1:CAT,ch2:FISH";
    process.env.DISCORD_GUILD_ID = "guild-1";
    process.env.FUEL_CHECK_HOUR = "0";
    process.env.FUEL_CHECK_MINUTE = "1";

    jest.setSystemTime(new Date("2026-02-04T00:00:00.000"));

    const ac = new AbortController();
    await startFuelCheckScheduler({ redis, signal: ac.signal });

    await jest.advanceTimersByTimeAsync(65_000);

    expect(mockPublishCmdToRedisStream).toHaveBeenCalledTimes(2);
    expect(mockBuildCmdEnvelope).toHaveBeenCalledTimes(2);

    const calls = mockBuildCmdEnvelope.mock.calls;
    const tenantKeys = calls.map((c) => c[0].tenantKey);
    expect(tenantKeys.sort()).toEqual(["CAT", "FISH"]);

    for (const call of calls) {
        const input = call[0];
        expect(input.cmd).toBe("연료-일일체크");
        expect(input.args).toBe("");
        expect(input.meta).toEqual(
            expect.objectContaining({
                guildId: "guild-1",
                discordUserId: "",
            })
        );
        expect(typeof input.meta.channelId).toBe("string");
        expect(typeof input.meta.issuedAt).toBe("number");
    }
    expect(mockBuildCmdEnvelope.mock.calls[0][0].meta.channelId).toBe("ch1");
    expect(mockBuildCmdEnvelope.mock.calls[1][0].meta.channelId).toBe("ch2");

    delete process.env.FUEL_CHECK_TENANT_KEYS;
    delete process.env.DISCORD_TENANT_MAP;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.FUEL_CHECK_HOUR;
    delete process.env.FUEL_CHECK_MINUTE;
});
