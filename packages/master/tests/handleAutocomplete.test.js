// packages/master/tests/handleAutocomplete.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockResolveTenantKey = jest.fn();

await jest.unstable_mockModule("../src/config/tenantChannelMap.js", () => ({
    resolveTenantKey: mockResolveTenantKey,
}));

const { handleAutocomplete } = await import("../src/usecases/handleAutocomplete.js");

function interaction(overrides = {}) {
    return {
        channelId: "1462754270406377482",
        commandName: "함대장변경",
        user: { id: "user-1" },
        options: { getFocused: () => "" },
        ...overrides,
    };
}

describe("master/usecases/handleAutocomplete", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("resolveTenantKey null(허용되지 않은 채널) → [] 반환, rPush 미호출", async () => {
        mockResolveTenantKey.mockReturnValue(null);
        const redis = {
            rPush: jest.fn(),
            get: jest.fn(),
            del: jest.fn().mockResolvedValue(undefined),
        };

        const result = await handleAutocomplete(interaction(), { redis });

        expect(result).toEqual([]);
        expect(redis.rPush).not.toHaveBeenCalled();
    });

    test("허용 채널 + redis.get 첫 폴링에서 JSON 배열 반환 → 해당 배열 반환, rPush 1회", async () => {
        mockResolveTenantKey.mockReturnValue("CAT");
        const choices = [
            { name: "Char A", value: "1" },
            { name: "Char B", value: "2" },
        ];
        const redis = {
            rPush: jest.fn().mockResolvedValue(1),
            get: jest.fn().mockResolvedValue(JSON.stringify(choices)),
            del: jest.fn().mockResolvedValue(undefined),
        };

        const result = await handleAutocomplete(interaction(), { redis });

        expect(result).toEqual(choices);
        expect(redis.rPush).toHaveBeenCalledTimes(1);
        expect(redis.rPush).toHaveBeenCalledWith(
            "bonsai:ac:CAT",
            expect.stringContaining("requestId")
        );
    });
});
