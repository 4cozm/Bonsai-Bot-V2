// packages/orchestrator/src/esi/exchangeEveCode.js
import { logger } from "@bonsai/shared";

const log = logger();
const EVE_TOKEN_URL = "https://login.eveonline.com/v2/oauth/token";

const DEFAULT_EXPIRES_IN = 1200;

/**
 * EVE OAuth authorization code로 access_token(JWT) 교환.
 * Basic Auth: client_id:client_secret base64.
 *
 * @param {{ code: string, redirectUri: string, clientId: string, clientSecret: string }}
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in: number } | null>}
 */
export async function exchangeEveCode({ code, redirectUri, clientId, clientSecret }) {
    const c = String(code ?? "").trim();
    if (!c) return null;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: c,
        redirect_uri: redirectUri,
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
        log.error("[esi:token] 교환 실패", { status: res.status, body: text });
        return null;
    }
    const data = await res.json();
    const accessToken = data?.access_token;
    if (!accessToken) {
        log.warn("[esi:token] access_token 없음", data);
        return null;
    }
    const refreshToken = data?.refresh_token ?? null;
    const expiresIn = Number(data?.expires_in) || DEFAULT_EXPIRES_IN;
    return {
        access_token: accessToken,
        refresh_token: refreshToken || undefined,
        expires_in: expiresIn,
    };
}
