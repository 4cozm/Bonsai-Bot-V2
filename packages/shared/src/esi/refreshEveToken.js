// packages/shared/src/esi/refreshEveToken.js
import { logger } from "../utils/logger.js";

const log = logger();
const EVE_TOKEN_URL = "https://login.eveonline.com/v2/oauth/token";

/**
 * EVE OAuth refresh_token으로 새 access_token 발급.
 * Web app: Basic Auth (client_id:client_secret), grant_type=refresh_token, refresh_token=...
 *
 * @param {{ refreshToken: string, clientId: string, clientSecret: string, scope?: string }}
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in: number } | null>}
 */
export async function refreshEveToken({ refreshToken, clientId, clientSecret, scope }) {
    const r = String(refreshToken ?? "").trim();
    if (!r) {
        log.warn("[esi:refresh] refreshToken 비어있음");
        return null;
    }
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: r,
        ...(scope ? { scope } : {}),
    }).toString();

    const res = await fetch(EVE_TOKEN_URL, {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    });

    if (!res.ok) {
        const text = await res.text();
        log.error("[esi:refresh] 갱신 실패", { status: res.status, body: text });
        return null;
    }
    const data = await res.json();
    const accessToken = data?.access_token;
    if (!accessToken) {
        log.warn("[esi:refresh] access_token 없음", data);
        return null;
    }
    const newRefreshToken = data?.refresh_token ?? undefined;
    const expiresIn = Number(data?.expires_in) || 1200;
    return {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        expires_in: expiresIn,
    };
}
