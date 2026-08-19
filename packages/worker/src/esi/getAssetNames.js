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

// 최대 재시도 횟수(원 시도 포함하면 총 3번). 1번만 재시도하던 시절 실측으로 겪은
// 문제: ESI가 420/429(요청 제한)로 두 번 연속 실패하면 그 청크의 함선 전부가
// "이름 없음"으로 떨어졌다 — 같은 콥에 다른 진단/조회가 동시에 몰리면(예: 관리자가
// /자산진단을 무겁게 여러 번 돌리는 중) 한 번의 재시도로는 그 요청 제한 구간을
// 못 벗어나는 경우가 실제로 있었다. 시도마다 대기 시간도 늘려서(선형 백오프)
// 같은 순간에 또 걸릴 확률을 낮춘다.
const MAX_ATTEMPTS = 3;

/**
 * ESI가 일시적으로 흔들릴 때(네트워크 순간 끊김, 5xx, 420/429 요청 제한) 잠깐씩 쉬었다
 * 다시 시도한다 — 프론트 eveTypes.js의 withRetry와 같은 패턴. 이게 없어서 실제로 겪은
 * 문제: 배치 하나가 실패하면 그 안의 함선 전부가 그 동기화 사이클에서 "이름 없음"으로
 * 떨어져 커스텀명 없는 다른 함선들과 typeId 기준으로 뭉쳐 보였다 — 인게임에서는 전부
 * 이름이 붙어 있는데도. 다음 시간 정각 동기화 때 우연히 성공하면 다시 정상으로 보여서,
 * 원인 파악 없이는 "가끔 이름이 사라진다"로만 보였다.
 */
async function withRetry(fn) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            // 404는 "이 요청 자체가(이름 지정 불가 id가 섞여서) 결정적으로 거부됨"이라
            // 재시도해도 100% 똑같이 또 404다 — 백오프로 시간 낭비하지 않고 바로
            // 포기한다. 호출부(fetchBatch)가 이걸 보고 배치를 쪼개서 문제 id를
            // 좁혀나간다.
            if (err?.status === 404) break;
            if (attempt < MAX_ATTEMPTS) {
                await sleep(attempt * (400 + Math.random() * 400));
            }
        }
    }
    throw lastErr;
}

async function postNames(url, token, batchIds) {
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
}

/**
 * 배치 하나를 조회한다. 실측 확인됨: ESI는 이름 지정 불가한 아이템(함선에 장착된
 * 모듈·화물, 청사진 사본 등 is_singleton:true지만 "이름 지정 가능한 카테고리"가
 * 아닌 것)이 배치에 하나라도 섞이면 그 배치 전체를 404로 거부한다 — 부분 실패가
 * 아니라 전부 거부라, 같은 배치에 우연히 같이 묶인 진짜 이름 붙은 함선까지 전부
 * 이름을 잃는다. aggregateHangarStock에서 함선 장착 모듈은 이미 걸러내지만,
 * 행어에 직접 있는 청사진 사본처럼 걸러지지 않는 이름 지정 불가 아이템도 있을 수
 * 있어(실측으로 계속 발생) 완전히 막을 수는 없다 — 그래서 404를 받으면 재시도
 * 대신 배치를 반으로 쪼개서 어느 쪽에 문제 id가 있는지 좁혀 나간다(이분 탐색).
 * 문제 id 하나만 딱 골라내면 되고, 나머지 199개는 정상적으로 이름을 받는다.
 * 크기 1까지 쪼갰는데도 404면 그 id 자체가 이름 지정 불가한 게 확실한 것이니
 * "실패"로 안 치고 그냥 이름 없음으로 조용히 넘어간다(원래 없는 이름 취급과 동일).
 * 5xx/420/429/네트워크 오류처럼 재시도가 의미 있는 실패만 withRetry를 거친다.
 */
async function fetchBatch(url, token, batchIds, corporationId) {
    try {
        const rows = await withRetry(() => postNames(url, token, batchIds));
        return { rows, failed: false, unnameableIds: [] };
    } catch (err) {
        if (err?.status === 404 && batchIds.length > 1) {
            const mid = Math.floor(batchIds.length / 2);
            const [left, right] = await Promise.all([
                fetchBatch(url, token, batchIds.slice(0, mid), corporationId),
                fetchBatch(url, token, batchIds.slice(mid), corporationId),
            ]);
            return {
                rows: [...left.rows, ...right.rows],
                failed: left.failed || right.failed,
                unnameableIds: [...left.unnameableIds, ...right.unnameableIds],
            };
        }
        if (err?.status === 404) {
            // 크기 1까지 좁혔는데도 404 — 이 id 자체가 이름 지정 불가한 게 확정됐다.
            // 재시도로 고칠 수 있는 종류의 실패가 아니라 "원래 없는 이름"과 같은
            // 상태라, hadFailures는 안 켠다(정리 로직을 불필요하게 계속 막지 않도록).
            // 정체를 알아내려면 호출부(syncStructure)가 원본 asset 목록과 이 id를
            // 대조해서 type_id/location_flag를 로그로 남길 수 있어야 해서, id
            // 자체는 조용히 버리지 않고 unnameableIds로 올려보낸다.
            return { rows: [], failed: false, unnameableIds: batchIds };
        }
        log.warn("[esi:assetNames] 요청 실패(재시도 포함)", {
            corporationId,
            status: err?.status,
            batchSize: batchIds.length,
            message: err?.status == null ? (err?.message ?? String(err)) : undefined,
        });
        return { rows: [], failed: true, unnameableIds: [] };
    }
}

/**
 * 콥 자산 item_id들의 이름을 조회한다. 이름이 지정 안 된(기본 이름 그대로인) 아이템은
 * ESI가 아예 결과에서 빼므로, 반환 맵에 없는 item_id는 "이름 없음"으로 취급하면 된다.
 *
 * @param {string} accessToken - Bearer token
 * @param {number} corporationId
 * @param {number[]} itemIds
 * @returns {Promise<{names: Map<number, string>, hadFailures: boolean, unnameableIds: number[]}>}
 *          names는 item_id → name. hadFailures는 5xx/420/429/네트워크처럼 재시도까지
 *          실패한 "진짜 문제"가 있었을 때만 true다(이름 지정 불가 id 하나 때문에 켜지지
 *          않는다 — 그건 이분 탐색으로 이미 걸러내고 조용히 넘어감). 호출부
 *          (syncStructure)는 hadFailures를 보고 "이번 사이클엔 이름을 못 구한 게
 *          있으니, 이번엔 비어 보이는 함선의 옛 기록을 지우면 안 된다"를 판단한다 —
 *          안 그러면 일시적 조회 실패 하나가 실제로 존재하는 함선의 30일 이력을
 *          영구 삭제하는 사고로 이어질 수 있다(실제로 겪음). unnameableIds는 이분
 *          탐색으로 확정된, 이름 지정 자체가 안 되는 item_id 목록 — 호출부가 원본
 *          asset 목록과 대조하면 실제로 어떤 종류의 아이템이 배치를 404로 거부하게
 *          만드는지(type_id/location_flag) 진단할 수 있다.
 */
export async function getAssetNames(accessToken, corporationId, itemIds) {
    const token = String(accessToken ?? "").trim();
    const ids = [...new Set(itemIds)];
    if (!token || ids.length === 0)
        return { names: new Map(), hadFailures: false, unnameableIds: [] };

    const url = `${ESI_ASSET_NAMES_URL}/${corporationId}/assets/names/`;
    const batches = chunk(ids, IDS_PER_REQUEST);

    const results = await Promise.all(
        batches.map((batchIds) => fetchBatch(url, token, batchIds, corporationId))
    );

    const names = new Map();
    let hadFailures = false;
    const unnameableIds = [];
    for (const { rows, failed, unnameableIds: ids } of results) {
        if (failed) hadFailures = true;
        unnameableIds.push(...ids);
        for (const row of rows) {
            if (row?.item_id != null && row?.name) names.set(row.item_id, row.name);
        }
    }
    return { names, hadFailures, unnameableIds };
}
