// packages/shared/tests/publishCmdToRedisStream.test.js
import { describe, expect, jest, test } from "@jest/globals";
import { publishCmdToRedisStream } from "../src/bus/publishCmdToRedisStream.js";

describe("shared/bus/publishCmdToRedisStream", () => {
    test("envelope.tenantKey 비어있음 → throw", async () => {
        const redis = { xAdd: () => Promise.resolve("x") };
        await expect(
            publishCmdToRedisStream({ redis, envelope: { tenantKey: "" } })
        ).rejects.toThrow("tenantKey가 비어있습니다.");
        await expect(publishCmdToRedisStream({ redis, envelope: {} })).rejects.toThrow(
            "tenantKey가 비어있습니다."
        );
    });

    test("정상 envelope → xAdd 호출, payload에 envelope JSON", async () => {
        let capturedStream;
        let capturedPayload;
        const redis = {
            xAdd: jest.fn(async (stream, id, fields) => {
                capturedStream = stream;
                capturedPayload = fields.payload;
                return "entry-456";
            }),
        };
        const envelope = {
            type: "cmd",
            id: "cmd-uuid-2",
            tenantKey: "CAT",
            cmd: "mineralPrice",
            args: "{}",
        };

        const id = await publishCmdToRedisStream({ redis, envelope });

        expect(id).toBe("entry-456");
        expect(redis.xAdd).toHaveBeenCalledWith("bonsai:cmd:CAT", "*", expect.any(Object));
        expect(capturedStream).toBe("bonsai:cmd:CAT");
        const parsed = JSON.parse(capturedPayload);
        expect(parsed.tenantKey).toBe("CAT");
        expect(parsed.cmd).toBe("mineralPrice");
        expect(parsed.id).toBe("cmd-uuid-2");
    });
});
