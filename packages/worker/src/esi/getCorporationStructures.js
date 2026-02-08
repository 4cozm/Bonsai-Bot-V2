import { logger } from "@bonsai/shared";

const log = logger();
const ESI_STRUCTURES_URL = "https://esi.evetech.net/latest/corporations";

/**
 * ESI corporations/{corporationId}/structures 호출.
 *
 * @param {string} accessToken - Bearer token
 * @param {number} corporationId - EVE corporation ID
 * @returns {Promise<object[] | null>} structures 배열 또는 실패 시 null
 */
export async function getCorporationStructures(accessToken, corporationId) {
    const token = String(accessToken ?? "").trim();
    if (!token) return null;

    const url = `${ESI_STRUCTURES_URL}/${corporationId}/structures/`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        });
        const bodyText = await res.text();
        if (!res.ok) {
            log.warn("[esi:structures] 요청 실패", {
                corporationId,
                status: res.status,
                statusText: res.statusText,
                body: bodyText.length > 500 ? `${bodyText.slice(0, 500)}…` : bodyText,
            });
            return null;
        }
        let result = null;
        try {
            result = bodyText ? JSON.parse(bodyText) : [];
        } catch {
            result = [];
        }
        return result;
    } catch (err) {
        log.warn("[esi:structures] fetch 예외", {
            corporationId,
            message: err?.message ?? String(err),
        });
        return null;
    }
}
