// packages/shared/tests/envelope.test.js
import { describe, expect, test } from "@jest/globals";
import { buildCmdEnvelope, buildResultEnvelope } from "../src/bus/envelope.js";

describe("shared/bus/envelope", () => {
    test("buildCmdEnvelope: 최소 계약 생성", () => {
        const env = buildCmdEnvelope({
            tenantKey: "CAT",
            cmd: "ping",
            args: "",
            meta: {
                discordUserId: "u1",
                guildId: "g1",
                channelId: "c1",
                issuedAt: 123,
            },
        });

        expect(env).toEqual(
            expect.objectContaining({
                type: "cmd",
                tenantKey: "CAT",
                cmd: "ping",
                args: "",
                meta: expect.objectContaining({
                    discordUserId: "u1",
                    guildId: "g1",
                    channelId: "c1",
                    issuedAt: 123,
                }),
            })
        );

        // correlationId(UUID)는 값 자체를 고정하지 않고 존재/문자열만 확인
        expect(typeof env.id).toBe("string");
        expect(env.id.length).toBeGreaterThan(10);
    });

    test("buildCmdEnvelope: tenantKey/cmd 누락이면 throw", () => {
        expect(() =>
            buildCmdEnvelope({
                tenantKey: "",
                cmd: "ping",
                meta: { discordUserId: "u1", guildId: "g1", channelId: "c1" },
            })
        ).toThrow();

        expect(() =>
            buildCmdEnvelope({
                tenantKey: "CAT",
                cmd: "",
                meta: { discordUserId: "u1", guildId: "g1", channelId: "c1" },
            })
        ).toThrow();
    });

    test("buildCmdEnvelope: meta 필수 누락이면 throw", () => {
        expect(() =>
            buildCmdEnvelope({
                tenantKey: "CAT",
                cmd: "ping",
                meta: { discordUserId: "", guildId: "g1", channelId: "c1" },
            })
        ).toThrow();

        expect(() =>
            buildCmdEnvelope({
                tenantKey: "CAT",
                cmd: "ping",
                meta: { discordUserId: "u1", guildId: "", channelId: "c1" },
            })
        ).toThrow();

        expect(() =>
            buildCmdEnvelope({
                tenantKey: "CAT",
                cmd: "ping",
                meta: { discordUserId: "u1", guildId: "g1", channelId: "" },
            })
        ).toThrow();
    });

    test("buildCmdEnvelope: issuedAt 없으면 자동 채움(숫자)", () => {
        const env = buildCmdEnvelope({
            tenantKey: "CAT",
            cmd: "ping",
            meta: { discordUserId: "u1", guildId: "g1", channelId: "c1" },
        });

        expect(typeof env.meta.issuedAt).toBe("number");
        expect(Number.isFinite(env.meta.issuedAt)).toBe(true);
    });

    test("buildResultEnvelope: inReplyTo 필수", () => {
        expect(() => buildResultEnvelope({ inReplyTo: "", ok: true, data: null })).toThrow();
    });

    test("buildResultEnvelope: 계약 생성", () => {
        const r = buildResultEnvelope({
            inReplyTo: "cmd-uuid",
            ok: true,
            data: { x: 1 },
            meta: { tenantKey: "CAT" },
        });

        expect(r).toEqual(
            expect.objectContaining({
                type: "result",
                inReplyTo: "cmd-uuid",
                ok: true,
                data: { x: 1 },
                meta: { tenantKey: "CAT" },
            })
        );

        expect(typeof r.id).toBe("string");
        expect(r.id.length).toBeGreaterThan(10);
    });
});
