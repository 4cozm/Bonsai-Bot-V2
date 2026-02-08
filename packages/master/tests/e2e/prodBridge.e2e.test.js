// Boundary E2E: envelope 왕복 + handleResult + Discord Mock(editReply). Redis는 인메모리 최소 contract.
import { describe, expect, jest, test } from "@jest/globals";
import { buildCmdEnvelope, buildResultEnvelope } from "@bonsai/shared";
import { handleResult } from "../../src/initialize/startProdBridge.js";
import { getCommandDefinitions } from "../../../worker/src/commands/index.js";

function buildCommandMap() {
    const map = new Map();
    for (const c of getCommandDefinitions()) map.set(c.name, c);
    return map;
}

describe("e2e / Boundary (Master↔Worker↔Discord)", () => {
    test("핑: envelope → execute → result → handleResult → editReply 1회, payload에 embed", async () => {
        const commandMap = buildCommandMap();
        const pingCmd = commandMap.get("핑");
        expect(pingCmd).toBeDefined();

        const tenantKey = "CAT";
        const envelope = buildCmdEnvelope({
            tenantKey,
            cmd: "핑",
            args: "{}",
            meta: {
                discordUserId: "u1",
                guildId: "g1",
                channelId: "ch1",
            },
        });

        const mockEditReply = jest.fn().mockResolvedValue(undefined);
        const mockFollowUp = jest.fn().mockResolvedValue(undefined);
        const pendingMap = new Map();
        pendingMap.set(envelope.id, {
            interaction: {
                editReply: mockEditReply,
                followUp: mockFollowUp,
            },
        });

        const ctx = {
            tenantKey,
            metrics: {
                issuedAtMs: Date.now() - 50,
                workerReceivedAtMs: Date.now(),
            },
        };
        const result = await pingCmd.execute(ctx, envelope);
        const resultEnv = buildResultEnvelope({
            inReplyTo: envelope.id,
            ok: result.ok,
            data: result.data,
            meta: result.meta ?? {},
        });

        const handled = await handleResult({
            resultEnv,
            pendingMap,
            source: "redis",
        });

        expect(handled).toBe(true);
        expect(pendingMap.has(envelope.id)).toBe(false);
        expect(mockEditReply).toHaveBeenCalledTimes(1);
        const payload = mockEditReply.mock.calls[0][0];
        expect(payload).toBeDefined();
        const hasEmbed = payload.embeds?.length > 0 || payload.content;
        expect(hasEmbed || payload.embeds).toBeTruthy();
        if (payload.embeds?.[0]) {
            expect(payload.embeds[0].title).toBe("퐁 (핑)");
        }
    });
});
