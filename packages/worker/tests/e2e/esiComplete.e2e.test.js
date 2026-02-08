// Worker integration (command-level): esi-complete — meta.broadcastToChannel·channelId·guildId 검증
import { describe, expect, jest, test } from "@jest/globals";
import esiCompleteCmd from "../../src/commands/esiComplete.js";
import { buildDiscordReplyPayload } from "../../../master/src/discord/buildDiscordReplyPayload.js";

describe("e2e / esi-complete (esiComplete)", () => {
    test("정상 PENDING + characterId/characterName → ok:true, meta.broadcastToChannel true, meta.channelId·guildId", async () => {
        const reg = {
            id: "reg-1",
            status: "PENDING",
            characterId: 999n,
            characterName: "TestChar",
            discordUserId: "discord-u1",
            mainCandidate: true,
        };
        const txMock = {
            eveCharacter: {
                findFirst: jest.fn().mockResolvedValue(null),
                upsert: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
            },
            esiRegistration: { update: jest.fn().mockResolvedValue({}) },
        };
        const prisma = {
            esiRegistration: { findUnique: jest.fn().mockResolvedValue(reg) },
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            $transaction: jest.fn((fn) => fn(txMock)),
        };
        const ctx = { prisma, tenantKey: "CAT" };
        const envelope = {
            id: "env-1",
            cmd: "esi-complete",
            meta: { channelId: "ch-123", guildId: "g-456" },
            args: JSON.stringify({ registrationId: "reg-1" }),
        };

        const result = await esiCompleteCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.data.title).toBe("EVE ESI 연동 완료");
        expect(result.meta).toEqual(
            expect.objectContaining({
                broadcastToChannel: true,
                channelId: "ch-123",
                guildId: "g-456",
            })
        );
        const payload = buildDiscordReplyPayload(result.data);
        expect(payload.embeds?.length > 0 || payload.content).toBeTruthy();
    });
});
