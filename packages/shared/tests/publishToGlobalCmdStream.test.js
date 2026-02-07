// packages/shared/tests/publishToGlobalCmdStream.test.js
import { describe, expect, jest, test } from "@jest/globals";
import { publishToGlobalCmdStream } from "../src/bus/publishToGlobalCmdStream.js";

describe("shared/bus/publishToGlobalCmdStream", () => {
    test("envelope null → throw", async () => {
        const redis = { xAdd: () => Promise.resolve("x") };
        await expect(publishToGlobalCmdStream({ redis, envelope: null })).rejects.toThrow(
            "envelope(type=cmd)가 필요합니다."
        );
    });

    test("envelope.type !== 'cmd' → throw", async () => {
        const redis = { xAdd: () => Promise.resolve("x") };
        await expect(
            publishToGlobalCmdStream({ redis, envelope: { type: "result", inReplyTo: "a" } })
        ).rejects.toThrow("envelope(type=cmd)가 필요합니다.");
    });

    test("정상 envelope → xAdd 호출, forwarded에 tenantKey/scope global", async () => {
        let capturedPayload;
        const redis = {
            xAdd: jest.fn(async (stream, id, fields) => {
                capturedPayload = fields.payload;
                return "entry-123";
            }),
        };
        const envelope = {
            type: "cmd",
            id: "cmd-uuid-1",
            tenantKey: "CAT",
            cmd: "시세",
            args: "{}",
            meta: { issuedAt: 123 },
        };

        const id = await publishToGlobalCmdStream({ redis, envelope });

        expect(id).toBe("entry-123");
        expect(redis.xAdd).toHaveBeenCalledWith("bonsai:cmd:global", "*", expect.any(Object));
        const payload = JSON.parse(capturedPayload);
        expect(payload.tenantKey).toBe("global");
        expect(payload.scope).toBe("global");
        expect(payload.id).toBe("cmd-uuid-1");
        expect(payload.cmd).toBe("시세");
        expect(payload.meta.issuedAt).toBe(123);
    });
});
