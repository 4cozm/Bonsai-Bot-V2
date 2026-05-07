import { createClient } from "redis";

describe("Redis Streams - DLQ Poison Pill Recovery", () => {
    let redis;
    const streamKey = "bonsai:cmd:test-jest-dlq";
    const group = "bonsai-jest-worker";
    const consumer = "c-jest-test";

    beforeAll(async () => {
        // 실제 연동 테스트(Integration Test)를 위해 로컬 Redis에 연결
        redis = createClient({ url: process.env.REDIS_URL || "redis://127.0.0.1:6379" });
        await redis.connect();
    });

    afterAll(async () => {
        if (redis) {
            await redis.del(streamKey);
            await redis.quit();
        }
    });

    test("10초 방치된 독약 메시지는 XAUTOCLAIM 시 deliveryCount가 2 이상이 되어 DLQ 처리되어야 한다", async () => {
        // 1. 초기화
        await redis.del(streamKey);
        try {
            await redis.xGroupCreate(streamKey, group, "$", { MKSTREAM: true });
        } catch (e) {
            if (!e.message.includes("BUSYGROUP")) throw e;
        }

        // 2. 메시지 삽입
        const payload = JSON.stringify({ type: "cmd", tenantKey: "jest", cmd: "TEST_POISON" });
        const msgId = await redis.xAdd(streamKey, "*", { payload });
        expect(msgId).toBeDefined();

        // 3. 첫 번째 소비 (크래시 시뮬레이션: XACK 호출 안함)
        const readRes = await redis.xReadGroup(group, consumer, [{ key: streamKey, id: ">" }], {
            COUNT: 1,
            BLOCK: 1000
        });
        expect(readRes).toBeDefined();
        expect(readRes[0].messages[0].id).toBe(msgId);

        // 4. 복구 스케줄러 시뮬레이션 (XAUTOCLAIM)
        // 실제로는 10초를 기다려야 하지만, 테스트 속도를 위해 방치 시간(min-idle-time)을 0으로 설정하여 즉시 회수
        const autoClaimRes = await redis.xAutoClaim(streamKey, group, consumer, 0, "0-0", { COUNT: 1 });
        const recoveredMessages = autoClaimRes?.messages || [];
        
        expect(recoveredMessages.length).toBe(1);
        expect(recoveredMessages[0].id).toBe(msgId);

        // 5. 시도 횟수 확인 로직 (앱 내부 로직과 동일)
        const pendingInfo = await redis.xPendingRange(streamKey, group, msgId, msgId, 1);
        const deliveryCount = pendingInfo?.[0]?.deliveriesCounter ?? 1;

        // XAUTOCLAIM을 통해 소유권을 가져왔으므로 카운트가 2가 되어야 정상
        expect(deliveryCount).toBeGreaterThanOrEqual(2);

        // 6. DLQ 폐기 처리 (XACK)
        if (deliveryCount >= 2) {
            await redis.xAck(streamKey, group, msgId);
        }

        // 7. 대기열(PEL)이 비워졌는지 최종 검증
        const finalPending = await redis.xPending(streamKey, group);
        expect(finalPending.pending).toBe(0);
    });
});
