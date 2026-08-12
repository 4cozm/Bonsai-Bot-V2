// packages/shared/tests/magicLink.test.js
import { describe, expect, jest, test } from "@jest/globals";
import { issueMagicLinkToken, consumeMagicLinkToken } from "../src/auth/magicLink.js";

function makeFakeRedis() {
    const store = new Map();
    return {
        store,
        set: jest.fn(async (key, value, opts) => {
            if (opts?.NX && store.has(key)) return null;
            store.set(key, value);
            return "OK";
        }),
        getDel: jest.fn(async (key) => {
            const v = store.get(key);
            store.delete(key);
            return v ?? null;
        }),
    };
}

describe("shared/auth/magicLink", () => {
    test("발급한 토큰을 소비하면 원래 payload가 나오고, 다시 소비하면 null이다(1회용)", async () => {
        const redis = makeFakeRedis();
        const token = await issueMagicLinkToken(redis, { discordId: "111", tenantKey: "CAT" }, 300);

        const first = await consumeMagicLinkToken(redis, token);
        expect(first).toEqual({ discordId: "111", tenantKey: "CAT" });

        const second = await consumeMagicLinkToken(redis, token);
        expect(second).toBeNull();
    });

    test("존재하지 않는 토큰을 소비하면 null이다", async () => {
        const redis = makeFakeRedis();
        const result = await consumeMagicLinkToken(redis, "no-such-token");
        expect(result).toBeNull();
    });

    test("getDel이 없는 redis 클라이언트(구버전)에서도 get+del로 동작한다", async () => {
        const store = new Map();
        const redis = {
            set: jest.fn(async (key, value) => {
                store.set(key, value);
                return "OK";
            }),
            get: jest.fn(async (key) => store.get(key) ?? null),
            del: jest.fn(async (key) => store.delete(key)),
        };
        const token = await issueMagicLinkToken(redis, { discordId: "222" }, 300);
        const result = await consumeMagicLinkToken(redis, token);
        expect(result).toEqual({ discordId: "222" });
        expect(redis.del).toHaveBeenCalled();
    });
});
