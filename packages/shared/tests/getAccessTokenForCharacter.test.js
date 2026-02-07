// packages/shared/tests/getAccessTokenForCharacter.test.js
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockRefreshEveToken = jest.fn();
await jest.unstable_mockModule("../src/esi/refreshEveToken.js", () => ({
    refreshEveToken: mockRefreshEveToken,
}));

const { getAccessTokenForCharacter } = await import("../src/esi/getAccessTokenForCharacter.js");

describe("shared/esi/getAccessTokenForCharacter", () => {
    const charId = 12345n;
    const validRow = {
        characterId: charId,
        accessToken: "old-token",
        refreshToken: "old-refresh",
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    };

    beforeEach(() => {
        mockRefreshEveToken.mockReset();
    });

    afterEach(() => {
        delete process.env.EVE_ESI_CLIENT_ID;
        delete process.env.EVE_ESI_CLIENT_SECRET;
    });

    test("eveCharacter 없음 → null", async () => {
        const prisma = {
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue(null),
                update: jest.fn(),
            },
        };
        const result = await getAccessTokenForCharacter(prisma, charId);
        expect(result).toBeNull();
        expect(prisma.eveCharacter.update).not.toHaveBeenCalled();
    });

    test("accessToken null → null", async () => {
        const prisma = {
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue({
                    ...validRow,
                    accessToken: null,
                    refreshToken: "r",
                }),
                update: jest.fn(),
            },
        };
        const result = await getAccessTokenForCharacter(prisma, charId);
        expect(result).toBeNull();
    });

    test("refreshToken null → null", async () => {
        const prisma = {
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue({
                    ...validRow,
                    refreshToken: null,
                }),
                update: jest.fn(),
            },
        };
        const result = await getAccessTokenForCharacter(prisma, charId);
        expect(result).toBeNull();
    });

    test("tokenExpiresAt 아직 유효 → DB accessToken 그대로 반환", async () => {
        const prisma = {
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue(validRow),
                update: jest.fn(),
            },
        };
        const result = await getAccessTokenForCharacter(prisma, charId);
        expect(result).toBe("old-token");
        expect(mockRefreshEveToken).not.toHaveBeenCalled();
        expect(prisma.eveCharacter.update).not.toHaveBeenCalled();
    });

    test("만료 임박 → refresh 호출, 성공 시 update 후 새 access_token 반환", async () => {
        process.env.EVE_ESI_CLIENT_ID = "cid";
        process.env.EVE_ESI_CLIENT_SECRET = "secret";
        const expiredRow = {
            ...validRow,
            tokenExpiresAt: new Date(Date.now() - 1000),
        };
        mockRefreshEveToken.mockResolvedValue({
            access_token: "new-token",
            refresh_token: "new-rt",
            expires_in: 1200,
        });
        const updateMock = jest.fn().mockResolvedValue(undefined);
        const prisma = {
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue(expiredRow),
                update: updateMock,
            },
        };

        const result = await getAccessTokenForCharacter(prisma, charId);

        expect(result).toBe("new-token");
        expect(mockRefreshEveToken).toHaveBeenCalledWith({
            refreshToken: "old-refresh",
            clientId: "cid",
            clientSecret: "secret",
        });
        expect(updateMock).toHaveBeenCalledWith({
            where: { characterId: charId },
            data: expect.objectContaining({
                accessToken: "new-token",
                tokenExpiresAt: expect.any(Date),
            }),
        });
    });

    test("refresh 실패 → null", async () => {
        process.env.EVE_ESI_CLIENT_ID = "c";
        process.env.EVE_ESI_CLIENT_SECRET = "s";
        mockRefreshEveToken.mockResolvedValue(null);
        const prisma = {
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue({
                    ...validRow,
                    tokenExpiresAt: new Date(0),
                }),
                update: jest.fn(),
            },
        };

        const result = await getAccessTokenForCharacter(prisma, charId);

        expect(result).toBeNull();
        expect(prisma.eveCharacter.update).not.toHaveBeenCalled();
    });

    test("clientId/clientSecret 없음(env) → null", async () => {
        const prisma = {
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue({
                    ...validRow,
                    tokenExpiresAt: new Date(0),
                }),
                update: jest.fn(),
            },
        };

        const result = await getAccessTokenForCharacter(prisma, charId);

        expect(result).toBeNull();
        expect(mockRefreshEveToken).not.toHaveBeenCalled();
    });

    test("characterId number 전달 → BigInt로 조회", async () => {
        const prisma = {
            eveCharacter: {
                findUnique: jest.fn().mockResolvedValue(validRow),
                update: jest.fn(),
            },
        };
        const result = await getAccessTokenForCharacter(prisma, 12345);
        expect(result).toBe("old-token");
        expect(prisma.eveCharacter.findUnique).toHaveBeenCalledWith({
            where: { characterId: 12345n },
        });
    });
});
