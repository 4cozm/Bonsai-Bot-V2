// packages/worker/src/schedulers/stockSyncScheduler.js
// 콥행어(CorpSAG1~7) 재고를 주기적으로 스캔해 StockLog에 기록한다.

import cron from "node-cron";
import { getAccessTokenForCharacter, parseAnchorCharIds, logger } from "@bonsai/shared";

const ESI_BASE = "https://esi.evetech.net/latest";
// ESI 콥 자산 엔드포인트가 최대 1시간(3600초) 캐시라, 더 자주 돌아도 새 데이터를 못 받는다.
const CRON_SCHEDULE = "0 * * * *"; // 매시 정각
const CORPSAG_FLAG_RE = /^CorpSAG[1-7]$/;

/**
 * 콥 자산을 페이지네이션 끝까지 받는다. 실패하면 null(부분 성공 없음 — 재고 숫자를
 * 반토막 낸 채로 기록하면 "부족" 오판정을 유발하므로 전부 못 받으면 이번 사이클은
 * 건너뛴다).
 */
async function fetchAllCorpAssets(corporationId, accessToken) {
    const assets = [];
    let page = 1;
    let totalPages = 1;

    do {
        const res = await fetch(
            `${ESI_BASE}/corporations/${corporationId}/assets/?datasource=tranquility&page=${page}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) return null;
        totalPages = Number(res.headers.get("x-pages") ?? 1) || 1;
        assets.push(...(await res.json()));
        page += 1;
    } while (page <= totalPages);

    return assets;
}

/**
 * structureId 아래 콥 행어(CorpSAG1~7) 안에 있는 아이템을 typeId별로 합산한다.
 *
 * CorpSAG 플래그는 상속된다 — 콥이 행어 안에 이름 붙인 컨테이너(예: "3.탄약")를
 * 넣어뒀으면, 그 컨테이너 자체는 flag가 CorpSAG4지만 그 안의 실제 탄약은
 * location_flag가 컨테이너 내용물 flag(예: Unlocked)로 나오고 division 정보가
 * 자기 자신한테는 없다 — 가장 가까운 조상의 CorpSAG flag를 그대로 물려받는다.
 * 실측 데이터로 확인됨: 구조물 → (오피스 등 중간 아이템) → CorpSAG6 → 실제 함선
 * 처럼 중간에 몇 단계가 끼어도 상관없이 동작해야 해서 깊이 제한 없이 BFS한다.
 *
 * 컨테이너 자체(예: "3.탄약" 아이템 그 자체)도 하나의 typeId로 같이 집계된다 —
 * 걸러내려면 아이템 카테고리를 추가 조회해야 하는데, 목표 재고를 안 잡아둔
 * typeId는 프론트에서 자연히 안 보이므로 굳이 거를 필요가 없다.
 *
 * @param {bigint | number | string} structureId
 * @param {{item_id:number, type_id:number, location_id:number, location_flag:string, quantity:number}[]} assets
 * @returns {Map<number, number>} typeId → 합산 수량
 */
export function aggregateHangarStock(structureId, assets) {
    const childrenByParent = new Map();
    for (const a of assets) {
        const key = String(a.location_id);
        if (!childrenByParent.has(key)) childrenByParent.set(key, []);
        childrenByParent.get(key).push(a);
    }

    const stockByType = new Map();
    const visited = new Set();
    let frontier = (childrenByParent.get(String(structureId)) ?? []).map((item) => ({
        item,
        division: CORPSAG_FLAG_RE.test(item.location_flag) ? item.location_flag : null,
    }));

    while (frontier.length > 0) {
        const next = [];
        for (const { item, division } of frontier) {
            if (visited.has(item.item_id)) continue;
            visited.add(item.item_id);

            if (division) {
                stockByType.set(item.type_id, (stockByType.get(item.type_id) ?? 0) + item.quantity);
            }

            for (const child of childrenByParent.get(String(item.item_id)) ?? []) {
                const inheritedDivision = CORPSAG_FLAG_RE.test(child.location_flag)
                    ? child.location_flag
                    : division;
                next.push({ item: child, division: inheritedDivision });
            }
        }
        frontier = next;
    }

    return stockByType;
}

/**
 * 구조물 하나를 동기화한다: 토큰 확보 → 콥 자산 조회 → 콥행어 집계 → StockLog 기록.
 * @param {{ prisma: import("@prisma/client").PrismaClient, structure: {structureId: bigint, corporationId: number}, anchorCharacterId: bigint, log: {info:Function, warn:Function} }} params
 */
export async function syncStructure({ prisma, structure, anchorCharacterId, log }) {
    const accessToken = await getAccessTokenForCharacter(prisma, anchorCharacterId, { log });
    if (!accessToken) {
        log.warn("[stock-sync] 토큰 없음, 구조물 스킵", {
            structureId: String(structure.structureId),
        });
        return;
    }

    const assets = await fetchAllCorpAssets(structure.corporationId, accessToken);
    if (!assets) {
        log.warn("[stock-sync] 콥 자산 조회 실패, 구조물 스킵", {
            structureId: String(structure.structureId),
        });
        return;
    }

    const stockByType = aggregateHangarStock(structure.structureId, assets);
    const sampledAt = new Date();
    if (stockByType.size > 0) {
        await prisma.stockLog.createMany({
            data: [...stockByType.entries()].map(([typeId, quantity]) => ({
                structureId: structure.structureId,
                typeId,
                quantity,
                sampledAt,
            })),
        });
    }

    log.info("[stock-sync] 동기화 완료", {
        structureId: String(structure.structureId),
        itemTypes: stockByType.size,
    });
}

/**
 * 재고 동기화 cron 등록. TrackedStructure(active=true) 전부를 순회하며, 각
 * corporationId에 맞는 앵커 캐릭터를 EVE_ANCHOR_CHARIDS에서 찾아 사용한다 —
 * 구조물 소유 콥과 콥행어 소유 콥이 다를 수 있어(실측 확인됨) 앵커를
 * corporationId 기준으로 매칭한다.
 * @param {object} params
 * @param {import("@prisma/client").PrismaClient} params.prisma
 * @param {string} params.tenantKey
 * @param {AbortSignal} [params.signal]
 * @param {{ info: Function, warn: Function, error: Function }} [params.log]
 */
export function startStockSyncScheduler({ prisma, tenantKey, signal, log }) {
    const logInstance = log ?? logger();

    const task = cron.schedule(CRON_SCHEDULE, async () => {
        if (signal?.aborted) return;

        const structures = await prisma.trackedStructure.findMany({ where: { active: true } });
        if (structures.length === 0) return;

        const anchors = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS);

        for (const structure of structures) {
            if (signal?.aborted) return;
            const anchor = anchors.find((a) => a.corporationId === structure.corporationId);
            if (!anchor) {
                logInstance.warn("[stock-sync] EVE_ANCHOR_CHARIDS에 해당 콥 앵커 없음", {
                    tenantKey,
                    corporationId: structure.corporationId,
                    structureId: String(structure.structureId),
                });
                continue;
            }
            try {
                await syncStructure({
                    prisma,
                    structure,
                    anchorCharacterId: anchor.characterId,
                    log: logInstance,
                });
            } catch (err) {
                logInstance.error("[stock-sync] 구조물 동기화 중 오류", {
                    structureId: String(structure.structureId),
                    message: err?.message,
                });
            }
        }
    });

    if (signal) {
        signal.addEventListener("abort", () => task.stop(), { once: true });
    }

    logInstance.info("[stock-sync] 재고 동기화 cron 등록 완료 (매시 정각)");
}
