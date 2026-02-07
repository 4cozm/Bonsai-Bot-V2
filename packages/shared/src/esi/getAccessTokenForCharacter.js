// packages/shared/src/esi/getAccessTokenForCharacter.js
import { logger } from "../utils/logger.js";
import { refreshEveToken } from "./refreshEveToken.js";

const DEFAULT_EXPIRY_BUFFER_SECONDS = 60;

/**
 * characterId로 유효한 accessToken 반환.
 * 만료 임박/만료 시 refresh_token으로 재발급 후 DB 갱신하고 반환.
 *
 * @param {import("@prisma/client").PrismaClient} prisma - 테넌트별 Prisma (getPrisma(tenantKey))
 * @param {string | number | bigint} characterId - EVE character_id
 * @param {{ log?: { warn: Function }, expiryBufferSeconds?: number }} [options]
 * @returns {Promise<string | null>} accessToken 또는 없음/실패 시 null
 */
export async function getAccessTokenForCharacter(prisma, characterId, options = {}) {
    const log = options.log ?? logger();
    const bufferSec = options.expiryBufferSeconds ?? DEFAULT_EXPIRY_BUFFER_SECONDS;

    const cid = typeof characterId === "bigint" ? characterId : BigInt(characterId);
    const row = await prisma.eveCharacter.findUnique({
        where: { characterId: cid },
    });
    if (!row || row.accessToken == null || row.refreshToken == null) {
        return null;
    }

    const now = Date.now();
    const expiresAt = row.tokenExpiresAt ? row.tokenExpiresAt.getTime() : 0;
    const threshold = now + bufferSec * 1000;
    const isExpired = expiresAt <= threshold;

    if (!isExpired) {
        return row.accessToken;
    }

    const clientId = String(process.env.EVE_ESI_CLIENT_ID ?? "").trim();
    const clientSecret = String(process.env.EVE_ESI_CLIENT_SECRET ?? "").trim();
    if (!clientId || !clientSecret) {
        log.warn(
            "[esi:getAccessToken] EVE_ESI_CLIENT_ID 또는 EVE_ESI_CLIENT_SECRET 없음, refresh 불가"
        );
        return null;
    }

    const refreshed = await refreshEveToken({
        refreshToken: row.refreshToken,
        clientId,
        clientSecret,
    });
    if (!refreshed) {
        log.warn("[esi:getAccessToken] refresh 실패 characterId=" + String(cid));
        return null;
    }

    const tokenExpiresAt = new Date(now + refreshed.expires_in * 1000);
    await prisma.eveCharacter.update({
        where: { characterId: cid },
        data: {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token ?? row.refreshToken,
            tokenExpiresAt,
        },
    });

    return refreshed.access_token;
}
