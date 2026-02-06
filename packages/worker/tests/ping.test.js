// packages/worker/tests/ping.test.js
import { describe, expect, test } from "@jest/globals";
import pingCmd from "../src/commands/ping.js";

describe("worker/commands/ping execute", () => {
    test("성공 시 ok:true, data에 embed·title·fields 존재", async () => {
        const ctx = {
            tenantKey: "CAT",
            metrics: {
                issuedAtMs: Date.now() - 50,
                workerReceivedAtMs: Date.now(),
            },
        };
        const envelope = { id: "e1", cmd: "핑" };

        const result = await pingCmd.execute(ctx, envelope);

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(result.data).toBeDefined();
        expect(result.data.embed).toBe(true);
        expect(result.data.title).toBe("퐁 (핑)");
        expect(Array.isArray(result.data.fields)).toBe(true);
        expect(result.data.fields.length).toBeGreaterThanOrEqual(3);
        expect(result.data.fields.map((f) => f.name)).toContain("Discord → Worker");
        expect(result.data.fields.map((f) => f.name)).toContain("Worker 총 처리");
        expect(result.data.fields.map((f) => f.name)).toContain("Handler");
    });

    test("data.metrics 존재, workerReceivedAtMs·workerFinishedAtMs 숫자", async () => {
        const ctx = { tenantKey: "FISH", metrics: { issuedAtMs: 1, workerReceivedAtMs: 2 } };
        const envelope = { id: "e2", cmd: "핑" };

        const result = await pingCmd.execute(ctx, envelope);

        expect(result.data.metrics).toBeDefined();
        expect(typeof result.data.metrics.workerReceivedAtMs).toBe("number");
        expect(typeof result.data.metrics.workerFinishedAtMs).toBe("number");
    });
});
