// packages/orchestrator/tests/dtScheduler.test.js
process.env.TZ = "Asia/Seoul";

import { expect, jest, test } from "@jest/globals";

jest.useFakeTimers();

// ✅ ESM 모킹: unstable_mockModule + dynamic import 조합
await jest.unstable_mockModule("../src/utils/getServerStatus.js", () => ({
    getServerStatus: jest.fn(),
}));

await jest.unstable_mockModule("../src/utils/postDiscordWebhook.js", () => ({
    postDiscordWebhook: jest.fn(),
}));

await jest.unstable_mockModule("../src/utils/alertSkillPoint.js", () => ({
    alertSkillPointIfTuesday: jest.fn(),
}));

// ✅ 모킹 등록 후 import
const { startDtScheduler } = await import("../src/schedulers/dtScheduler.js");
const { getServerStatus } = await import("../src/utils/getServerStatus.js");
const { postDiscordWebhook } = await import("../src/utils/postDiscordWebhook.js");
const { alertSkillPointIfTuesday } = await import("../src/utils/alertSkillPoint.js");

function mkRedis() {
    const seen = new Set();
    return {
        set: jest.fn(async (key, val, opt) => {
            if (opt?.NX) {
                if (seen.has(key)) return null;
                seen.add(key);
                return "OK";
            }
            return "OK";
        }),
    };
}

test("VIP은 1회만 알리고, vip=false 되면 OPEN을 1회 알린다", async () => {
    // ✅ 웹훅/폴링 설정
    process.env.DISCORD_DT_WEBHOOK_URL = "https://example.com/dt";
    process.env.DT_POLL_MS = "1000";

    // ✅ KST 기준: 2026-02-04 00:00:30
    // (TZ=Asia/Seoul이므로 아래 ISO는 KST로 해석됨)
    const now = new Date("2026-02-04T00:00:30.000");
    jest.setSystemTime(now);

    // ✅ 스케줄은 '1분 뒤(00:01)'로 잡아서 오늘 안에 실행되게
    process.env.DT_CHECK_HOUR = "0";
    process.env.DT_CHECK_MINUTE = "1";

    // ✅ date check 통과를 위해 start_time도 같은 'KST 오늘'로 맞춤
    const sameDayStart = new Date("2026-02-04T00:00:00.000").toISOString();

    // 부팅 baseline 1회 + 폴링 3회: vip -> vip(버전업) -> open
    getServerStatus
        .mockResolvedValueOnce({
            server_version: "100",
            start_time: sameDayStart,
            vip: true,
        })
        .mockResolvedValueOnce({
            server_version: "100",
            start_time: sameDayStart,
            vip: true,
        })
        .mockResolvedValueOnce({
            server_version: "101",
            start_time: sameDayStart,
            vip: true,
        })
        .mockResolvedValueOnce({
            server_version: "101",
            start_time: sameDayStart,
            vip: false,
        });

    const redis = mkRedis();
    const ac = new AbortController();

    await startDtScheduler({ redis, signal: ac.signal });

    // ✅ 00:01:00 실행까지 30초 + 여유
    await jest.advanceTimersByTimeAsync(35_000);

    // ✅ interval(1초) 몇 번 돌려서 open까지 도달
    await jest.advanceTimersByTimeAsync(5_000);

    // VIP 1회 + OPEN 1회
    expect(postDiscordWebhook).toHaveBeenCalledTimes(2);

    // OPEN 이후 1회 호출 (내부에서 화요일 체크)
    expect(alertSkillPointIfTuesday).toHaveBeenCalledTimes(1);

    // (선택) OPEN 이후 interval이 멈추는지 대충 확인하고 싶으면:
    // expect(getServerStatus).toHaveBeenCalledTimes(4);
});
