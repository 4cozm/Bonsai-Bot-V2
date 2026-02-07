// packages/worker/src/esi/getCorporationStructures.js
import { logger } from "@bonsai/shared";

const log = logger();
const ESI_BASE = "https://esi.evetech.net/latest";

/**
 * EVE ESI corporations/{corporation_id}/structures/ 조회.
 *
 * @param {number} corporationId
 * @param {string} accessToken
 * @returns {Promise<Array<{ name: string, fuel_expires: string, type_id: number, [key: string]: unknown }> | null>}
 */
export async function getCorporationStructures(corporationId, accessToken) {
    const url = `${ESI_BASE}/corporations/${corporationId}/structures/`;
    try {
        const res = await fetch(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        if (!res.ok) {
            log.warn("[esi:structures] 조회 실패", {
                corporationId,
                status: res.status,
                statusText: res.statusText,
            });
            return null;
        }
        const data = await res.json();
        return Array.isArray(data) ? data : null;
    } catch (err) {
        log.warn("[esi:structures] 요청 오류", { corporationId, message: err?.message });
        return null;
    }
}
