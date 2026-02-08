// Worker integration (command-level): 가입 — redis·prisma·shared(issueNonce, signState, parseEveEsiScope) Mock
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { buildDiscordReplyPayload } from "../../../master/src/discord/buildDiscordReplyPayload.js";

const mockIssueNonce = jest.fn();
const mockSignState = jest.fn();
const mockParseEveEsiScope = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    issueNonce: mockIssueNonce,
    signState: mockSignState,
    parseEveEsiScope: mockParseEveEsiScope,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const esiSignupCmd = (await import("../../src/commands/esiSignup.js")).default;

describe("e2e / 가입 (esiSignup)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIssueNonce.mockResolvedValue(true);
        mockSignState.mockReturnValue("dummy-state-string");
        mockParseEveEsiScope.mockReturnValue("esi-characters.read_contacts.v1");
        process.env.ESI_STATE_SECRET = "test-secret";
        process.env.EVE_ESI_CLIENT_ID = "test-client-id";
        process.env.EVE_ESI_REDIRECT_URI = "https://example.com/callback";
    });

    test("정상 경로 → ok:true, data.embed·ephemeral URL 포함, data.title EVE ESI 가입 링크", async () => {
        const redis = {
            set: jest.fn().mockImplementation((_key, _val, opts) => {
                if (opts?.NX && opts?.EX) return Promise.resolve("OK");
                return Promise.resolve("OK");
            }),
        };
        const prisma = {
            discordUser: { upsert: jest.fn().mockResolvedValue({}) },
            esiRegistration: { create: jest.fn().mockResolvedValue({}) },
        };
        const ctx = { redis, prisma, tenantKey: "CAT" };
        const envelope = {
            id: "env-1",
            cmd: "가입",
            meta: {
                discordUserId: "discord-u1",
                guildId: "g1",
                channelId: "ch1",
                discordNick: "UserOne",
            },
            args: "{}",
        };

        const result = await esiSignupCmd.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.data.embed).toBe(true);
        expect(result.data.title).toBe("EVE ESI 가입 링크");
        expect(result.data.ephemeral).toBeDefined();
        expect(typeof result.data.ephemeral).toBe("string");
        expect(result.data.ephemeral).toContain("login.eveonline.com");
        expect(result.data.ephemeral).toContain("EVE 로그인 링크");
        const payload = buildDiscordReplyPayload(result.data);
        expect(payload.embeds?.length > 0 || payload.content).toBeTruthy();
    });
});
