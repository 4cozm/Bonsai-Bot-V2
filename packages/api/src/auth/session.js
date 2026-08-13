// packages/api/src/auth/session.js
import { verifySessionJwt } from "@bonsai/shared";

export const SESSION_COOKIE_NAME = "bonsai_session";

/** Express는 기본으로 쿠키를 안 파싱한다 — 이 세션 하나만 읽으면 되는 용도라
 * cookie-parser 의존성 없이 직접 파싱한다. */
function parseCookieHeader(header) {
    const out = {};
    for (const pair of String(header ?? "").split(";")) {
        const idx = pair.indexOf("=");
        if (idx < 0) continue;
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(value);
    }
    return out;
}

/**
 * 요청의 세션 쿠키를 읽어 검증한다. 없거나 만료/위조면 null(예외를 던지지 않음 —
 * "로그인 안 됨"은 에러가 아니라 정상적으로 나올 수 있는 상태라서).
 * @param {import("express").Request} req
 * @returns {{discordId:string, tenantKey:string, iat:number, exp:number} | null}
 */
export function readSession(req) {
    const cookies = parseCookieHeader(req.headers?.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;

    const secret = String(process.env.STOCK_SESSION_JWT_SECRET ?? "").trim();
    if (!secret) return null;

    try {
        return verifySessionJwt(token, secret);
    } catch {
        return null;
    }
}

/**
 * 보호된 라우트용 미들웨어. 세션이 유효하면 req.session에 담고 통과, 아니면 401.
 */
export function requireSession(req, res, next) {
    const session = readSession(req);
    if (!session) {
        return res.status(401).json({ ok: false, error: "인증이 필요합니다." });
    }
    req.session = session;
    next();
}
