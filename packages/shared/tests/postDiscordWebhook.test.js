// packages/shared/tests/postDiscordWebhook.test.js
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { postDiscordWebhook } from "../src/utils/postDiscordWebhook.js";

describe("shared/utils/postDiscordWebhook", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("url 비어있음(빈 문자열) → throw", async () => {
        await expect(postDiscordWebhook({ url: "", payload: {} })).rejects.toThrow(
            "webhook url이 비어있습니다"
        );
    });

    test("url null → throw", async () => {
        await expect(postDiscordWebhook({ url: null, payload: {} })).rejects.toThrow(
            "webhook url이 비어있습니다"
        );
    });

    test("fetch가 res.ok = true 반환 → 예외 없이 완료", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
        });

        await expect(
            postDiscordWebhook({
                url: "https://discord.com/api/webhooks/123/abc",
                payload: { content: "test" },
            })
        ).resolves.toBeUndefined();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "https://discord.com/api/webhooks/123/abc",
            expect.objectContaining({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: "test" }),
            })
        );
    });

    test("fetch가 res.ok = false (404) → throw, 메시지에 status 포함", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: "Not Found",
            text: () => Promise.resolve("Not Found"),
        });

        await expect(
            postDiscordWebhook({
                url: "https://discord.com/api/webhooks/123/abc",
                payload: {},
            })
        ).rejects.toThrow("Webhook 전송 실패: 404 Not Found");
    });
});
