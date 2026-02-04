// packages/shared/src/esi/stateSign.js
import crypto from "node:crypto";

const PAYLOAD_VERSION = 1;

/**
 * state payload 최소 필드: v, discordId, discordNick, stateNonce, exp(Unix), tenantKey?, guildId?, channelId?, messageId?
 * @typedef {{ v: number, discordId: string, discordNick: string, stateNonce: string, exp: number, tenantKey?: string, guildId?: string, channelId?: string, messageId?: string }} StatePayload
 */

/**
 * HMAC 서명된 state 문자열 생성.
 * state = base64url(jsonPayload) + "." + base64url(hmacSha256(secret, base64url(jsonPayload)))
 *
 * @param {StatePayload} payload
 * @param {string} secret ESI_STATE_SECRET
 * @returns {string}
 */
export function signState(payload, secret) {
    if (!secret || typeof secret !== "string") {
        throw new Error("state sign: secret가 필요합니다.");
    }
    const normalized = {
        v: Number(payload?.v ?? PAYLOAD_VERSION),
        discordId: String(payload?.discordId ?? ""),
        discordNick: String(payload?.discordNick ?? ""),
        stateNonce: String(payload?.stateNonce ?? ""),
        exp: Number(payload?.exp ?? 0),
        ...(payload?.tenantKey != null && { tenantKey: String(payload.tenantKey) }),
        ...(payload?.guildId != null && { guildId: String(payload.guildId) }),
        ...(payload?.channelId != null && { channelId: String(payload.channelId) }),
        ...(payload?.messageId != null && { messageId: String(payload.messageId) }),
    };
    const json = JSON.stringify(normalized);
    const b64 = base64urlEncode(Buffer.from(json, "utf8"));
    const sig = crypto.createHmac("sha256", secret).update(b64).digest();
    const sigB64 = base64urlEncode(sig);
    return `${b64}.${sigB64}`;
}

/**
 * state 문자열 검증 후 payload 반환. 실패 시 예외.
 *
 * @param {string} state
 * @param {string} secret
 * @returns {StatePayload}
 */
export function verifyState(state, secret) {
    if (!state || typeof state !== "string") {
        throw new Error("state verify: state가 비어있습니다.");
    }
    if (!secret || typeof secret !== "string") {
        throw new Error("state verify: secret가 필요합니다.");
    }
    const dot = state.indexOf(".");
    if (dot <= 0 || dot >= state.length - 1) {
        throw new Error("state verify: 형식이 올바르지 않습니다.");
    }
    const b64 = state.slice(0, dot);
    const sigB64 = state.slice(dot + 1);
    const expectedSig = crypto.createHmac("sha256", secret).update(b64).digest();
    const expectedB64 = base64urlEncode(expectedSig);
    if (sigB64 !== expectedB64) {
        throw new Error("state verify: 서명이 일치하지 않습니다.");
    }
    let json;
    try {
        json = Buffer.from(base64urlDecode(b64), "base64").toString("utf8");
    } catch {
        throw new Error("state verify: payload 디코딩 실패");
    }
    let payload;
    try {
        payload = JSON.parse(json);
    } catch {
        throw new Error("state verify: payload JSON 파싱 실패");
    }
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
        throw new Error("state verify: 만료되었습니다.");
    }
    return {
        v: Number(payload?.v ?? 0),
        discordId: String(payload?.discordId ?? ""),
        discordNick: String(payload?.discordNick ?? ""),
        stateNonce: String(payload?.stateNonce ?? ""),
        exp,
        tenantKey: payload?.tenantKey != null ? String(payload.tenantKey) : undefined,
        guildId: payload?.guildId != null ? String(payload.guildId) : undefined,
        channelId: payload?.channelId != null ? String(payload.channelId) : undefined,
        messageId: payload?.messageId != null ? String(payload.messageId) : undefined,
    };
}

function base64urlEncode(buf) {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    return b64;
}
