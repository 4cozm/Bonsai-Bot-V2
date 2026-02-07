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
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}
