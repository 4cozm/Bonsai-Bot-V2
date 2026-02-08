// Worker integration (command-level): 캐릭터목록 — envelope.meta.discordUserId, prisma mock
import { describe, expect, jest, test } from "@jest/globals";
import esiListCmd from "../../src/commands/esiList.js";
import { buildDiscordReplyPayload } from "../../../master/src/discord/buildDiscordReplyPayload.js";

describe("e2e / 캐릭터목록 (esiList)", () => {
    test("캐릭터 2건 → ok:true, data.embed·title 연동 EVE 캐릭터 목록, fields[0].value에 캐릭터명", async () => {
        const prisma = {
            eveCharacter: {
                findMany: jest.fn().mockResolvedValue([
                    { characterName: "Char1", isMain: true },
                    { characterName: "Char2", isMain: false },
                ]),
            },
        };
        const ctx = { prisma, tenantKey: "CAT" };
        const envelope = {
            id: "env-1",
            cmd: "캐릭터목록",
            meta: { discordUserId: "discord-u1", guildId: "g1", channelId: "ch1" },
            args: "{}",
        };

        const result = await esiListCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.data.embed).toBe(true);
        expect(result.data.title).toBe("연동 EVE 캐릭터 목록");
        expect(result.data.fields).toHaveLength(1);
        expect(result.data.fields[0].value).toContain("Char1");
        expect(result.data.fields[0].value).toContain("Char2");
        const payload = buildDiscordReplyPayload(result.data);
        expect(payload.embeds?.length > 0 || payload.content).toBeTruthy();
    });

    test("캐릭터 0건 → ok:true, 연동된 캐릭터가 없습니다 메시지", async () => {
        const prisma = {
            eveCharacter: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const ctx = { prisma, tenantKey: "CAT" };
        const envelope = {
            id: "env-2",
            cmd: "캐릭터목록",
            meta: { discordUserId: "discord-u2", guildId: "g1", channelId: "ch1" },
            args: "{}",
        };

        const result = await esiListCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.data.embed).toBe(true);
        expect(result.data.fields[0].value).toBe("연동된 캐릭터가 없습니다.");
        const payload = buildDiscordReplyPayload(result.data);
        expect(payload.embeds?.length > 0 || payload.content).toBeTruthy();
    });
});
