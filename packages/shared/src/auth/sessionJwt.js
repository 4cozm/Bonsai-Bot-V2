// packages/shared/src/auth/sessionJwt.js
// 관리자 세션 토큰(httpOnly 쿠키에 담을 값). packages/shared/src/esi/stateSign.js와 같은
// HMAC 서명 방식이지만 용도가 다르다(ESI OAuth CSRF state가 아니라 7일짜리 로그인 세션) —
// 그래서 페이로드 모양도 다르고 별도 시크릿(STOCK_SESSION_JWT_SECRET)을 쓴다.

import crypto from "node:crypto";

/**
 * @typedef {{ discordId: string, tenantKey: string, iat: number, exp: number }} SessionPayload
 */

function base64urlEncode(buf) {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    return Buffer.from(b64, "base64");
}

/**
 * 세션 토큰 서명. token = base64url(payload) + "." + base64url(hmacSha256(secret, base64url(payload)))
 *
 * @param {{ discordId: string, tenantKey: string }} payload
 * @param {string} secret STOCK_SESSION_JWT_SECRET
 * @param {number} expiresInSec
 * @returns {string}
 */
export function signSessionJwt(payload, secret, expiresInSec) {
    if (!secret || typeof secret !== "string") {
        throw new Error("signSessionJwt: secret가 필요합니다.");
    }
    const now = Math.floor(Date.now() / 1000);
    const normalized = {
        discordId: String(payload?.discordId ?? ""),
        tenantKey: String(payload?.tenantKey ?? ""),
        iat: now,
        exp: now + Math.max(1, Math.floor(Number(expiresInSec) || 0)),
    };
    const b64 = base64urlEncode(Buffer.from(JSON.stringify(normalized), "utf8"));
    const sig = crypto.createHmac("sha256", secret).update(b64).digest();
    return `${b64}.${base64urlEncode(sig)}`;
}

/**
 * 세션 토큰 검증. 서명 불일치/만료/형식 오류 시 예외.
 * @param {string} token
 * @param {string} secret
 * @returns {SessionPayload}
 */
export function verifySessionJwt(token, secret) {
    if (!token || typeof token !== "string") {
        throw new Error("verifySessionJwt: token이 비어있습니다.");
    }
    if (!secret || typeof secret !== "string") {
        throw new Error("verifySessionJwt: secret가 필요합니다.");
    }
    const dot = token.indexOf(".");
    if (dot <= 0 || dot >= token.length - 1) {
        throw new Error("verifySessionJwt: 형식이 올바르지 않습니다.");
    }
    const b64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    const expectedSig = crypto.createHmac("sha256", secret).update(b64).digest();
    if (sigB64 !== base64urlEncode(expectedSig)) {
        throw new Error("verifySessionJwt: 서명이 일치하지 않습니다.");
    }
    let payload;
    try {
        payload = JSON.parse(base64urlDecode(b64).toString("utf8"));
    } catch {
        throw new Error("verifySessionJwt: payload 파싱 실패");
    }
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
        throw new Error("verifySessionJwt: 만료되었습니다.");
    }
    return {
        discordId: String(payload?.discordId ?? ""),
        tenantKey: String(payload?.tenantKey ?? ""),
        iat: Number(payload?.iat ?? 0),
        exp,
    };
}
