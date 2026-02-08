// packages/worker/tests/autocompleteConsumer.test.js
import { describe, expect, jest, test } from "@jest/globals";

const { runAutocompleteConsumer } = await import("../src/bus/autocompleteConsumer.js");

describe("worker/bus/autocompleteConsumer 알 수 없는 cmd", () => {
    test("commandMap에 없는 cmd 요청 시 redis.set('bonsai:ac:res:${requestId}', '[]', { EX: 10 }) 호출", async () => {
        const requestId = "test-req-123";
        const payload = JSON.stringify({
            requestId,
            commandName: "nonexistent-command",
            discordUserId: "u1",
            focusedValue: "",
        });
        const setMock = jest.fn().mockResolvedValue("OK");
        const ac = new AbortController();
        let first = true;
        const blPopMock = jest.fn().mockImplementation(() => {
            if (first) {
                first = false;
                return Promise.resolve({ element: payload });
            }
            ac.abort();
            return Promise.resolve(null);
        });

        const redis = { blPop: blPopMock, set: setMock };
        const runPromise = runAutocompleteConsumer({
            redis,
            prisma: null,
            tenantKey: "CAT",
            signal: ac.signal,
        });

        await runPromise;

        expect(setMock).toHaveBeenCalledWith(`bonsai:ac:res:${requestId}`, "[]", { EX: 10 });
    });
});
