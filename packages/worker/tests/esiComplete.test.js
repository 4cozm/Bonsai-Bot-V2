// packages/worker/tests/esiComplete.test.js
import { describe, expect, jest, test } from "@jest/globals";

import esiComplete from "../src/commands/esiComplete.js";

describe("worker/commands/esiComplete", () => {
    test("registrationId 없음 → ok: false, 등록 ID 메시지", async () => {
        const ctx = { prisma: {} };
        const envelope = {
            meta: { channelId: "ch1", guildId: "g1" },
            args: JSON.stringify({}),
        };
        const result = await esiComplete.execute(ctx, envelope);
        expect(result.ok).toBe(false);
        expect(result.data.error).toBe("등록 ID가 없습니다.");
    });

    test("channelId 없음 → ok: false, 채널 정보 메시지", async () => {
        const ctx = { prisma: {} };
        const envelope = {
            meta: { channelId: "", guildId: "g1" },
            args: JSON.stringify({ registrationId: "reg-1" }),
        };
        const result = await esiComplete.execute(ctx, envelope);
        expect(result.ok).toBe(false);
        expect(result.data.error).toBe("채널 정보가 없습니다.");
    });

    test("prisma 없음 → ok: false, 시스템 설정 오류", async () => {
        const ctx = {};
        const envelope = {
            meta: { channelId: "ch1", guildId: "g1" },
            args: JSON.stringify({ registrationId: "reg-1" }),
        };
        const result = await esiComplete.execute(ctx, envelope);
        expect(result.ok).toBe(false);
        expect(result.data.error).toBe("시스템 설정 오류");
    });

    test("등록 없음 → ok: false, 해당 등록을 찾을 수 없거나", async () => {
        const prisma = {
            esiRegistration: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        const ctx = { prisma };
        const envelope = {
            meta: { channelId: "ch1", guildId: "g1" },
            args: JSON.stringify({ registrationId: "reg-1" }),
        };
        const result = await esiComplete.execute(ctx, envelope);
        expect(result.ok).toBe(false);
        expect(result.data.error).toBe("해당 등록을 찾을 수 없거나 만료되었습니다.");
    });

    test("status !== PENDING → ok: false, 이미 처리된 요청", async () => {
        const prisma = {
            esiRegistration: {
                findUnique: jest.fn().mockResolvedValue({
                    id: "reg-1",
                    status: "CONFIRMED",
                    characterId: 123n,
                    characterName: "Char",
                    discordUserId: "u1",
                    mainCandidate: false,
                }),
            },
        };
        const ctx = { prisma };
        const envelope = {
            meta: { channelId: "ch1", guildId: "g1" },
            args: JSON.stringify({ registrationId: "reg-1" }),
        };
        const result = await esiComplete.execute(ctx, envelope);
        expect(result.ok).toBe(false);
        expect(result.data.error).toBe("이미 처리된 요청입니다.");
    });

    test("characterId/characterName null → ok: false, EVE 캐릭터 정보 반영 안됨", async () => {
        const prisma = {
            esiRegistration: {
                findUnique: jest.fn().mockResolvedValue({
                    id: "reg-1",
                    status: "PENDING",
                    characterId: null,
                    characterName: null,
                    discordUserId: "u1",
                    mainCandidate: false,
                }),
            },
        };
        const ctx = { prisma };
        const envelope = {
            meta: { channelId: "ch1", guildId: "g1" },
            args: JSON.stringify({ registrationId: "reg-1" }),
        };
        const result = await esiComplete.execute(ctx, envelope);
        expect(result.ok).toBe(false);
        expect(result.data.error).toContain("EVE 캐릭터 정보가 아직 반영되지 않았습니다");
    });

    test("정상 PENDING + characterId/characterName → transaction 후 ok: true, meta.broadcastToChannel", async () => {
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
            esiRegistration: {
                update: jest.fn().mockResolvedValue({}),
            },
        };
        const prisma = {
            esiRegistration: { findUnique: jest.fn().mockResolvedValue(reg) },
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            $transaction: jest.fn((fn) => fn(txMock)),
        };
        const ctx = { prisma };
        const envelope = {
            meta: { channelId: "ch-123", guildId: "g-1" },
            args: JSON.stringify({ registrationId: "reg-1" }),
        };

        const result = await esiComplete.execute(ctx, envelope);

        expect(result.ok).toBe(true);
        expect(result.meta).toEqual(
            expect.objectContaining({
                broadcastToChannel: true,
                channelId: "ch-123",
                guildId: "g-1",
            })
        );
        expect(result.data.title).toBe("EVE ESI 연동 완료");
        expect(prisma.$transaction).toHaveBeenCalled();
        expect(txMock.esiRegistration.update).toHaveBeenCalledWith({
            where: { id: "reg-1" },
            data: expect.objectContaining({ status: "CONFIRMED" }),
        });
    });

    test("transaction throw → ok: false, 저장 중 오류", async () => {
        const reg = {
            id: "reg-1",
            status: "PENDING",
            characterId: 999n,
            characterName: "TestChar",
            discordUserId: "u1",
            mainCandidate: false,
        };
        const prisma = {
            esiRegistration: { findUnique: jest.fn().mockResolvedValue(reg) },
            eveCharacter: { findUnique: jest.fn().mockResolvedValue(null) },
            $transaction: jest.fn().mockRejectedValue(new Error("db error")),
        };
        const ctx = { prisma };
        const envelope = {
            meta: { channelId: "ch1", guildId: "g1" },
            args: JSON.stringify({ registrationId: "reg-1" }),
        };

        const result = await esiComplete.execute(ctx, envelope);

        expect(result.ok).toBe(false);
        expect(result.data.error).toBe("저장 중 오류가 발생했습니다.");
    });
});
