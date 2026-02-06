// packages/shared/tests/stateSign.test.js
import { describe, expect, test } from "@jest/globals";
import { signState, verifyState } from "../src/esi/stateSign.js";

const SECRET = "test-secret-key";

describe("shared/esi/stateSign", () => {
    describe("signState", () => {
        test("secret 없음 → throw", () => {
            expect(() =>
                signState({ discordId: "1", discordNick: "n", stateNonce: "x", exp: 1 }, "")
            ).toThrow("state sign: secret가 필요합니다.");
            expect(() => signState({}, undefined)).toThrow("state sign: secret가 필요합니다.");
        });

        test("payload 정규화: 기본값 채움", () => {
            const state = signState(
                {
                    discordId: "u1",
                    discordNick: "nick",
                    stateNonce: "n1",
                    exp: 9999999999,
                },
                SECRET
            );
            expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
            const out = verifyState(state, SECRET);
            expect(out.v).toBe(1);
            expect(out.discordId).toBe("u1");
            expect(out.discordNick).toBe("nick");
            expect(out.stateNonce).toBe("n1");
            expect(out.exp).toBe(9999999999);
        });

        test("선택 필드 tenantKey, guildId, channelId 포함", () => {
            const state = signState(
                {
                    discordId: "u1",
                    discordNick: "n",
                    stateNonce: "x",
                    exp: 9999999999,
                    tenantKey: "CAT",
                    guildId: "g1",
                    channelId: "c1",
                },
                SECRET
            );
            const out = verifyState(state, SECRET);
            expect(out.tenantKey).toBe("CAT");
            expect(out.guildId).toBe("g1");
            expect(out.channelId).toBe("c1");
        });
    });

    describe("verifyState", () => {
        test("state 비어있음 → throw", () => {
            expect(() => verifyState("", SECRET)).toThrow("state verify: state가 비어있습니다.");
            expect(() => verifyState(undefined, SECRET)).toThrow(
                "state verify: state가 비어있습니다."
            );
        });

        test("secret 없음 → throw", () => {
            const state = signState(
                { discordId: "1", discordNick: "n", stateNonce: "x", exp: 9999999999 },
                SECRET
            );
            expect(() => verifyState(state, "")).toThrow("state verify: secret가 필요합니다.");
        });

        test("round-trip: 서명 후 검증 시 동일 payload", () => {
            const payload = {
                discordId: "u1",
                discordNick: "nick",
                stateNonce: "abc",
                exp: Math.floor(Date.now() / 1000) + 3600,
                tenantKey: "FISH",
            };
            const state = signState(payload, SECRET);
            const out = verifyState(state, SECRET);
            expect(out.discordId).toBe(payload.discordId);
            expect(out.discordNick).toBe(payload.discordNick);
            expect(out.stateNonce).toBe(payload.stateNonce);
            expect(out.exp).toBe(payload.exp);
            expect(out.tenantKey).toBe(payload.tenantKey);
        });

        test("형식 잘못됨(점 없음) → throw", () => {
            expect(() => verifyState("nodot", SECRET)).toThrow(
                "state verify: 형식이 올바르지 않습니다."
            );
        });

        test("서명 변조 시 → throw", () => {
            const state = signState(
                { discordId: "1", discordNick: "n", stateNonce: "x", exp: 9999999999 },
                SECRET
            );
            const [b64, sig] = state.split(".");
            const tampered = `${b64}.${sig.slice(0, -1)}X`;
            expect(() => verifyState(tampered, SECRET)).toThrow(
                "state verify: 서명이 일치하지 않습니다."
            );
        });

        test("만료된 exp → throw", () => {
            const state = signState(
                { discordId: "1", discordNick: "n", stateNonce: "x", exp: 1 },
                SECRET
            );
            expect(() => verifyState(state, SECRET)).toThrow("state verify: 만료되었습니다.");
        });
    });
});
