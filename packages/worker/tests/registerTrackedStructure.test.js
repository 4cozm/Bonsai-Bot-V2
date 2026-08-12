// packages/worker/tests/registerTrackedStructure.test.js
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockParseAnchorCharIds = jest.fn();
const mockSyncStructure = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    parseAnchorCharIds: mockParseAnchorCharIds,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

await jest.unstable_mockModule("../src/schedulers/stockSyncScheduler.js", () => ({
    syncStructure: mockSyncStructure,
}));

const { default: registerTrackedStructure } =
    await import("../src/commands/registerTrackedStructure.js");

const ALLOWED_DISCORD_ID = "378543198953406464";

describe("worker/commands/registerTrackedStructure", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.EVE_ANCHOR_CHARIDS = "98705746:2116660063,98641311:2115893596";
        mockParseAnchorCharIds.mockReturnValue([
            { corporationId: 98705746, characterId: 2116660063n },
            { corporationId: 98641311, characterId: 2115893596n },
        ]);
    });

    test("허용되지 않은 유저 → ok:false, ephemeral", async () => {
        const ctx = { prisma: {} };
        const envelope = { meta: { discordUserId: "111" }, args: "{}" };
        const out = await registerTrackedStructure.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.ephemeralReply).toBe(true);
    });

    test("prisma 없음 → ok:false, 시스템 설정 오류", async () => {
        const ctx = {};
        const envelope = { meta: { discordUserId: ALLOWED_DISCORD_ID }, args: "{}" };
        const out = await registerTrackedStructure.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("시스템 설정 오류");
    });

    test("구조물 item_id가 정수가 아니면 ok:false", async () => {
        const ctx = { prisma: { trackedStructure: { upsert: jest.fn() } } };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({ 구조물: "not-a-number", 콥: 98641311, 이름: "SAVE CAT" }),
        };
        const out = await registerTrackedStructure.execute(ctx, envelope);
        expect(out.ok).toBe(false);
        expect(ctx.prisma.trackedStructure.upsert).not.toHaveBeenCalled();
    });

    test("정상 입력 → upsert 후 즉시 1회 동기화하고 결과를 같이 보여준다", async () => {
        const upsert = jest.fn().mockResolvedValue({
            structureId: 1051025995560n,
            corporationId: 98641311,
            displayName: "SAVE CAT",
            active: true,
        });
        mockSyncStructure.mockResolvedValue({ ok: true, itemTypes: 42 });
        const ctx = { prisma: { trackedStructure: { upsert } } };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({
                구조물: "1051025995560",
                콥: 98641311,
                이름: "SAVE CAT",
            }),
        };

        const out = await registerTrackedStructure.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(upsert).toHaveBeenCalledWith({
            where: { structureId: 1051025995560n },
            create: {
                structureId: 1051025995560n,
                corporationId: 98641311,
                displayName: "SAVE CAT",
                active: true,
            },
            update: {
                corporationId: 98641311,
                displayName: "SAVE CAT",
                active: true,
            },
        });
        expect(mockSyncStructure).toHaveBeenCalledWith(
            expect.objectContaining({ anchorCharacterId: 2115893596n })
        );
        expect(out.data.description).toContain("SAVE CAT");
        expect(out.data.description).toContain("1051025995560");
        expect(out.data.description).toContain("42종 기록됨");
    });

    test("활성:false 로 등록하면 즉시 동기화는 스킵한다", async () => {
        const upsert = jest.fn().mockResolvedValue({
            structureId: 1051025995560n,
            corporationId: 98641311,
            displayName: "SAVE CAT",
            active: false,
        });
        const ctx = { prisma: { trackedStructure: { upsert } } };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({
                구조물: "1051025995560",
                콥: 98641311,
                이름: "SAVE CAT",
                활성: false,
            }),
        };

        const out = await registerTrackedStructure.execute(ctx, envelope);

        expect(mockSyncStructure).not.toHaveBeenCalled();
        expect(out.data.description).toContain("비활성 상태라 스킵");
    });

    test("EVE_ANCHOR_CHARIDS에 해당 콥 앵커가 없으면 동기화를 시도하지 않고 경고한다", async () => {
        mockParseAnchorCharIds.mockReturnValue([]);
        const upsert = jest.fn().mockResolvedValue({
            structureId: 1051025995560n,
            corporationId: 555000111,
            displayName: "Unknown Corp Structure",
            active: true,
        });
        const ctx = { prisma: { trackedStructure: { upsert } } };
        const envelope = {
            meta: { discordUserId: ALLOWED_DISCORD_ID },
            args: JSON.stringify({
                구조물: "1051025995560",
                콥: 555000111,
                이름: "Unknown Corp Structure",
            }),
        };

        const out = await registerTrackedStructure.execute(ctx, envelope);

        expect(mockSyncStructure).not.toHaveBeenCalled();
        expect(out.data.description).toContain("앵커가 없음");
    });
});
