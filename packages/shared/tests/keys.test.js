// packages/shared/tests/keys.test.js
import { describe, expect, test } from "@jest/globals";
import { keySetsFor } from "../src/config/keys.js";

describe("shared/config/keys keySetsFor", () => {
    test("master + isDev false → prod 필수 키 포함", () => {
        const out = keySetsFor({ role: "master", isDev: false });
        expect(out.tenantKeys).toEqual([]);
        expect(Array.isArray(out.sharedKeys)).toBe(true);
        expect(out.sharedKeys).toContain("REDIS_URL");
        expect(out.sharedKeys).toContain("AWS_REGION");
        expect(out.sharedKeys).toContain("DISCORD_APP_ID");
        expect(out.sharedKeys).toContain("DISCORD_TOKEN");
        expect(out.sharedKeys).toContain("PROD_SQS_RESULT_QUEUE_URL");
        expect(out.sharedKeys).not.toContain("DEV_SQS_QUEUE_URL");
    });

    test("master + isDev true → dev 필수 키 포함", () => {
        const out = keySetsFor({ role: "master", isDev: true });
        expect(out.tenantKeys).toEqual([]);
        expect(out.sharedKeys).toContain("DEV_SQS_QUEUE_URL");
        expect(out.sharedKeys).toContain("REDIS_URL");
    });

    test("worker + isDev false → worker prod 키 포함", () => {
        const out = keySetsFor({ role: "worker", isDev: false });
        expect(out.sharedKeys).toContain("REDIS_URL");
        expect(out.sharedKeys).toContain("ESI_STATE_SECRET");
        expect(out.sharedKeys).toContain("EVE_ESI_CLIENT_ID");
        expect(out.sharedKeys).toContain("EVE_ESI_SCOPE");
        expect(out.tenantKeys).toEqual([]);
    });

    test("worker + isDev true → worker common만 추가, dev 전용 빈 배열", () => {
        const out = keySetsFor({ role: "worker", isDev: true });
        expect(out.sharedKeys).toContain("REDIS_URL");
        expect(out.sharedKeys).toContain("TENANT_DB_URL_TEMPLATE");
    });

    test("global + isDev false → global prod 키 포함", () => {
        const out = keySetsFor({ role: "global", isDev: false });
        expect(out.tenantKeys).toEqual([]);
        expect(out.sharedKeys).toContain("REDIS_URL");
        expect(out.sharedKeys).toContain("DISCORD_DT_WEBHOOK_URL");
        expect(out.sharedKeys).toContain("DISCORD_ALERT_WEBHOOK_URL");
        expect(out.sharedKeys).toContain("EVE_ESI_SCOPE");
    });

    test("global + isDev true → global dev 빈 배열", () => {
        const out = keySetsFor({ role: "global", isDev: true });
        expect(out.sharedKeys).toContain("REDIS_URL");
    });

    test("unknown role → throw", () => {
        expect(() => keySetsFor({ role: "unknown", isDev: false })).toThrow(
            "unknown role: unknown"
        );
    });
});
