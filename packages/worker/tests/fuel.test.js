// packages/worker/tests/fuel.test.js
import { describe, expect, jest, test } from "@jest/globals";

const mockGetAccessTokenForCharacter = jest.fn();
const mockGetCorporationStructures = jest.fn();
const mockParseAnchorCharIds = jest.fn();

await jest.unstable_mockModule("@bonsai/shared", () => ({
    parseAnchorCharIds: mockParseAnchorCharIds,
    getAccessTokenForCharacter: mockGetAccessTokenForCharacter,
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

await jest.unstable_mockModule("../src/esi/getCorporationStructures.js", () => ({
    getCorporationStructures: mockGetCorporationStructures,
}));

const { default: fuel } = await import("../src/commands/fuel.js");

const prisma = {};
const tenantKey = "CAT";

function oneStructure() {
    const d = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    return {
        name: "Test Citadel",
        fuel_expires: d.toISOString(),
        type_id: 35832,
    };
}

describe("worker/commands 연료 (fuel) 에러 경로·ephemeral", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockParseAnchorCharIds.mockReturnValue([]);
    });

    test("prisma 없음 → ok:false, data.error 시스템 설정 오류", async () => {
        const ctx = { prisma: null, redis: null, tenantKey };
        const envelope = { args: "{}" };

        const out = await fuel.execute(ctx, envelope);

        expect(out.ok).toBe(false);
        expect(out.data.error).toBe("시스템 설정 오류");
    });

    test("EVE_ANCHOR_CHARIDS 비어있음 → ok:false, 적절한 error 메시지", async () => {
        mockParseAnchorCharIds.mockReturnValue([]);
        const ctx = { prisma, redis: null, tenantKey };
        const envelope = { args: "{}" };

        const out = await fuel.execute(ctx, envelope);

        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("EVE_ANCHOR_CHARIDS");
    });

    test("구조물 0건 → ok:false", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([]);
        const ctx = { prisma, redis: null, tenantKey };
        const envelope = { args: "{}" };

        const out = await fuel.execute(ctx, envelope);

        expect(out.ok).toBe(false);
        expect(out.data.error).toContain("스트럭쳐 정보가 없어요");
    });

    test("정상 조회 1회 → data.embed, embeds[0].fields 3개", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([oneStructure()]);
        const ctx = { prisma, redis: null, tenantKey };
        const envelope = { args: "{}" };

        const out = await fuel.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(out.data.embed).toBe(true);
        expect(out.data.embeds).toHaveLength(1);
        expect(out.data.embeds[0].fields).toHaveLength(3);
        expect(out.data.ephemeralReply).toBe(true);
    });

    test("args.ephemeral false → 성공 시 data.ephemeralReply false", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([oneStructure()]);
        const ctx = { prisma, redis: null, tenantKey };
        const envelope = { args: '{"ephemeral":false}' };

        const out = await fuel.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(out.data.ephemeralReply).toBe(false);
    });
});

describe("worker/commands 연료 (fuel) 1분 캐시", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("redis 없음 → 캐시 없이 조회, set 호출 없음", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([oneStructure()]);
        const setSpy = jest.fn();
        const ctx = { prisma, redis: null, tenantKey };
        const envelope = { args: "{}" };

        await fuel.execute(ctx, envelope);

        expect(setSpy).not.toHaveBeenCalled();
    });

    test("캐시 미스 → 조회 후 redis.set 1회, key·EX 60, data.embed 존재", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([oneStructure()]);
        const redis = {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue("OK"),
        };
        const ctx = { prisma, redis, tenantKey };
        const envelope = { args: "{}" };

        const out = await fuel.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(out.data.embed).toBe(true);
        expect(out.data.embeds).toHaveLength(1);
        expect(redis.set).toHaveBeenCalledTimes(1);
        expect(redis.set).toHaveBeenCalledWith("bonsai:cache:fuel:CAT", expect.any(String), {
            EX: 60,
        });
        const payload = JSON.parse(redis.set.mock.calls[0][1]);
        expect(payload.embed).toBe(true);
        expect(payload.embeds).toHaveLength(1);
    });

    test("캐시 히트 → getCorporationStructures 미호출, 반환 data에 embed + 요청 args의 ephemeralReply", async () => {
        const cachedPayload = JSON.stringify({
            embed: true,
            embeds: [
                {
                    title: "현재 스트럭쳐 연료 상태",
                    description: "캐시됨",
                    fields: [],
                    color: 0x800080,
                    timestamp: false,
                },
            ],
        });
        const redis = {
            get: jest.fn().mockResolvedValue(cachedPayload),
            set: jest.fn().mockResolvedValue("OK"),
        };
        const ctx = { prisma, redis, tenantKey };
        const envelope = { args: '{"ephemeral":false}' };

        const out = await fuel.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(out.data.embed).toBe(true);
        expect(out.data.embeds[0].title).toBe("현재 스트럭쳐 연료 상태");
        expect(out.data.ephemeralReply).toBe(false);
        expect(mockGetCorporationStructures).not.toHaveBeenCalled();
        expect(redis.set).not.toHaveBeenCalled();
    });

    test("캐시 파싱 실패(잘못된 JSON) → 조회 진행 후 set 재저장", async () => {
        mockParseAnchorCharIds.mockReturnValue([{ corporationId: 1, characterId: 2 }]);
        mockGetAccessTokenForCharacter.mockResolvedValue("token");
        mockGetCorporationStructures.mockResolvedValue([oneStructure()]);
        const redis = {
            get: jest.fn().mockResolvedValue("not-valid-json"),
            set: jest.fn().mockResolvedValue("OK"),
        };
        const ctx = { prisma, redis, tenantKey };
        const envelope = { args: "{}" };

        const out = await fuel.execute(ctx, envelope);

        expect(out.ok).toBe(true);
        expect(mockGetCorporationStructures).toHaveBeenCalled();
        expect(redis.set).toHaveBeenCalledTimes(1);
        expect(redis.set).toHaveBeenCalledWith("bonsai:cache:fuel:CAT", expect.any(String), {
            EX: 60,
        });
    });
});
