// packages/orchestrator/src/esi/decodeEveJwt.js
import { logger } from "@bonsai/shared";

const log = logger();

/**
 * EVE SSO access_token(JWT)에서 characterId, characterName 추출.
 * 서명 검증은 생략하고 payload만 디코딩. (토큰은 방금 EVE에서 받은 것이므로)
 *
 * @param {string} jwt
 * @returns {{ characterId: bigint, characterName: string } | null}
 */
export function decodeEveJwtPayload(jwt) {
    const s = String(jwt ?? "").trim();
    if (!s) return null;
    const parts = s.split(".");
    if (parts.length !== 3) return null;
    try {
        const raw = base64urlDecode(parts[1]);
        const payload = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        const sub = String(payload?.sub ?? "");
        const name = String(payload?.name ?? "").trim();
        // sub 형식: "CHARACTER:EVE:123456"
        const match = /^CHARACTER:EVE:(\d+)$/.exec(sub);
        if (!match || !name) {
            log.warn("[esi:jwt] sub/name 형식 이상", { sub, name: payload?.name });
            return null;
        }
        const characterId = BigInt(match[1]);
        return { characterId, characterName: name };
    } catch (err) {
        log.warn("[esi:jwt] 디코딩 실패", err);
        return null;
    }
}

function base64urlDecode(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    return b64;
}
