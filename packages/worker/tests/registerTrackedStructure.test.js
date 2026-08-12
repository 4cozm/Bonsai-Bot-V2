// packages/worker/tests/registerTrackedStructure.test.js
import { describe, expect, jest, test } from "@jest/globals";
import registerTrackedStructure from "../src/commands/registerTrackedStructure.js";

const ALLOWED_DISCORD_ID = "378543198953406464";

describe("worker/commands/registerTrackedStructure", () => {
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

    test("정상 입력 → structureId를 BigInt로 변환해 upsert하고 결과를 보여준다", async () => {
        const upsert = jest.fn().mockResolvedValue({
            structureId: 1051025995560n,
            corporationId: 98641311,
            displayName: "SAVE CAT",
            active: true,
        });
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
        expect(out.data.description).toContain("SAVE CAT");
        expect(out.data.description).toContain("1051025995560");
    });

    test("활성 옵션을 false로 주면 그대로 반영된다", async () => {
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

        await registerTrackedStructure.execute(ctx, envelope);

        expect(upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({ active: false }),
                update: expect.objectContaining({ active: false }),
            })
        );
    });
});
