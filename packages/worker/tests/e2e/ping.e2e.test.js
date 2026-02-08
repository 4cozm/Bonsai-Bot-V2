// Worker integration (command-level): 핑 — Master 형식 envelope, ok/data 검증
import { describe, expect, test } from "@jest/globals";
import pingCmd from "../../src/commands/ping.js";
import { buildDiscordReplyPayload } from "../../../master/src/discord/buildDiscordReplyPayload.js";

describe("e2e / 핑 (ping)", () => {
    test("Master envelope 형식 → ok:true, data.embed·fields·title 퐁 (핑)", async () => {
        const ctx = {
            tenantKey: "CAT",
            metrics: { issuedAtMs: Date.now() - 50, workerReceivedAtMs: Date.now() },
        };
        const envelope = { id: "e1", cmd: "핑" };

        const result = await pingCmd.execute(ctx, envelope);

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(result.data.embed).toBe(true);
        expect(Array.isArray(result.data.fields)).toBe(true);
        expect(result.data.title).toBe("퐁 (핑)");

        const payload = buildDiscordReplyPayload(result.data);
        expect(payload).toBeDefined();
        expect(payload.embeds?.length > 0 || payload.content).toBeTruthy();
    });
});
