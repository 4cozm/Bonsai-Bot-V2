// packages/shared/src/esi/parseAnchorCharIds.js

/**
 * EVE_ANCHOR_CHARIDS 환경 변수 파싱.
 * 형식: corp_id:eve_char_id,corp_id:eve_char_id (쉼표 구분, 공백 trim)
 *
 * @param {string | undefined} envValue
 * @returns {{ corporationId: number, characterId: bigint }[]}
 */
export function parseAnchorCharIds(envValue) {
    const raw = String(envValue ?? "").trim();
    if (!raw) return [];

    const pairs = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const result = [];

    for (const pair of pairs) {
        const idx = pair.indexOf(":");
        if (idx <= 0 || idx === pair.length - 1) continue;
        const corpStr = pair.slice(0, idx).trim();
        const charStr = pair.slice(idx + 1).trim();
        const corpId = Number(corpStr);
        const charId = BigInt(charStr);
        if (!Number.isInteger(corpId) || corpId <= 0) continue;
        if (charStr === "" || (charId <= 0n && charStr !== "0")) continue;
        result.push({ corporationId: corpId, characterId: charId });
    }

    return result;
}
