// packages/worker/src/esi/getAssetNames.js
// ESI corporations/{corporationId}/assets/names 호출. 콥행어 안 이름 붙은 컨테이너
// (예: "드론", "탄약")의 item_id → 실제 이름을 조회하는 데 쓴다 — 이 이름으로
// StockDivisionRule의 추적 여부를 가른다.

import { logger } from "@bonsai/shared";

const log = logger();
const ESI_ASSET_NAMES_URL = "https://esi.evetech.net/latest/corporations";
// ESI가 한 번에 받는 item_id 개수 제한(문서상 최대 999)보다 넉넉히 여유를 두고 자른다 —
// pricing.js/eveTypes.js에서 겪은 "한 번에 너무 많이 보내서 실패" 문제를 애초에 피한다.
const IDS_PER_REQUEST = 200;

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ESI가 일시적으로 흔들릴 때(네트워크 순간 끊김, 5xx, 420/429 요청 제한) 한 번은 잠깐
 * 쉬었다 다시 시도한다 — 프론트 eveTypes.js의 withRetry와 같은 패턴. 이게 없어서 실제로
 * 겪은 문제: 배치 하나가 우연히 실패하면 그 안의 함선 전부가 그 동기화 사이클에서
 * "이름 없음"으로 떨어져 커스텀명 없는 다른 함선들과 typeId 기준으로 뭉쳐 보였다 —
 * 인게임에서는 전부 이름이 붙어 있는데도. 다음 시간 정각 동기화 때 우연히 성공하면
 * 다시 정상으로 보여서, 원인 파악 없이는 "가끔 이름이 사라진다"로만 보였다.
 */
async function withRetry(fn) {
    try {
        return await fn();
    } catch (err) {
        await sleep(400 + Math.random() * 400);
        return fn();
    }
}

/**
 * 콥 자산 item_id들의 이름을 조회한다. 이름이 지정 안 된(기본 이름 그대로인) 아이템은
 * ESI가 아예 결과에서 빼므로, 반환 맵에 없는 item_id는 "이름 없음"으로 취급하면 된다.
 *
 * @param {string} accessToken - Bearer token
 * @param {number} corporationId
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, string>>} item_id → name. 재시도까지 실패한 청크만
 *          조용히 빠진다(부분 성공 허용 — 컨테이너 이름 몇 개 놓쳐도 그 아이템들이
 *          "이름 없음(미추적)"으로 안전하게 처리될 뿐, 전체 동기화를 막을 이유는 없다).
 */
export async function getAssetNames(accessToken, corporationId, itemIds) {
    const token = String(accessToken ?? "").trim();
    const ids = [...new Set(itemIds)];
    if (!token || ids.length === 0) return new Map();

    const url = `${ESI_ASSET_NAMES_URL}/${corporationId}/assets/names/`;
    const batches = chunk(ids, IDS_PER_REQUEST);

    const results = await Promise.all(
        batches.map(async (batchIds) => {
            const fetchOnce = async () => {
                const res = await fetch(url, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(batchIds),
                });
                if (!res.ok) {
                    const err = new Error(`[esi:assetNames] status=${res.status}`);
                    err.status = res.status;
                    throw err;
                }
                return res.json();
            };

            try {
                return await withRetry(fetchOnce);
            } catch (err) {
                log.warn("[esi:assetNames] 요청 실패(재시도 포함)", {
                    corporationId,
                    status: err?.status,
                    batchSize: batchIds.length,
                    message: err?.status == null ? (err?.message ?? String(err)) : undefined,
                });
                return [];
            }
        })
    );

    const byId = new Map();
    for (const row of results.flat()) {
        if (row?.item_id != null && row?.name) byId.set(row.item_id, row.name);
    }
    return byId;
}
