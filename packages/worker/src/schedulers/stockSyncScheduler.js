// packages/worker/src/schedulers/stockSyncScheduler.js
// 콥행어(CorpSAG1~7) 재고를 주기적으로 스캔해 StockLog에 기록한다.

import cron from "node-cron";
import { getAccessTokenForCharacter, parseAnchorCharIds, logger } from "@bonsai/shared";
import { getAssetNames } from "../esi/getAssetNames.js";
import { isTracked } from "./stockDivisionRules.js";

const ESI_BASE = "https://esi.evetech.net/latest";
// ESI 콥 자산 엔드포인트의 실제 캐시 만료 시각은 응답 Expires 헤더로 온다 — 정각(:00)에
// 딱 맞춰 갱신되는 게 아니라 콥/시점마다 제각각이라, "최대 1시간"이라고만 가정하고 매시
// 정각에 도는 건 캐시 경계 직전엔 헛수고, 직후엔 최대 1시간 가까이 묵은 데이터를 받을
// 위험이 있다. 그래서 이 tick은 5분마다 "구조물별로 지금 동기화할 때가 됐나"만 점검하고,
// 실제 다음 동기화 시각은 매번 응답 Expires 헤더를 읽어 구조물별로 따로 잡는다.
const TICK_SCHEDULE = "*/5 * * * *";
// Expires 헤더가 없을 때(최초 동기화, 조회 실패, 토큰 없음 등) 쓰는 기본 재시도 간격 —
// 예전 "매시 정각" 고정 스케줄과 같은 값이라 실패 시에도 예전보다 나빠지지 않는다.
const FALLBACK_INTERVAL_MS = 60 * 60 * 1000;
// 캐시 경계 직후 살짝 여유를 둔다 — 시계 오차로 아직 안 갱신된 캐시를 또 받는 것 방지.
const EXPIRY_BUFFER_MS = 10_000;
const CORPSAG_FLAG_RE = /^CorpSAG[1-7]$/;
const log = logger();

// structureId(문자열) → 다음 동기화가 의미 있어지는 시각(epoch ms). 이 tick 루프가
// 실제로 스케줄링에 쓰는 값은 이 인메모리 맵이다(워커 재시작되면 비워지는데, 그러면
// 다음 tick에서 바로 한 번 동기화하고 그때부터 진짜 Expires 기준으로 넘어간다 —
// 재시작 직후 잠깐 더 자주 도는 것 외엔 문제 없다).
const nextSyncAt = new Map();

/**
 * 다음 동기화 시각을 인메모리 맵(스케줄링에 실제로 쓰임)과 TrackedStructure.nextSyncAt
 * 컬럼(프론트 "다음 동기화 N분 후" 표시용)에 같이 기록한다. DB 기록이 실패해도 인메모리
 * 값은 이미 반영됐으니 동기화 스케줄 자체는 영향 없다 — 프론트 표시가 잠깐 안 맞을 뿐.
 */
async function scheduleNext(prisma, structureId, expiresAtMs) {
    const at =
        expiresAtMs != null ? expiresAtMs + EXPIRY_BUFFER_MS : Date.now() + FALLBACK_INTERVAL_MS;
    nextSyncAt.set(String(structureId), at);
    try {
        await prisma.trackedStructure.update({
            where: { structureId },
            data: { nextSyncAt: new Date(at) },
        });
    } catch (err) {
        log.warn("[stock-sync] nextSyncAt DB 기록 실패(스케줄링 자체엔 영향 없음)", {
            structureId: String(structureId),
            message: err?.message,
        });
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ESI가 일시적으로 흔들릴 때(네트워크 순간 끊김, 5xx, 420/429) 한 번은 잠깐 쉬었다 다시
// 시도한다 — getAssetNames.js의 withRetry와 같은 패턴, 같은 이유(재시도가 없으면 tick
// 시작 시점에 ESI가 잠깐 흔들리기만 해도 그 사이클 전체가 통째로 스킵됨).
async function withRetry(fn) {
    try {
        return await fn();
    } catch {
        await sleep(400 + Math.random() * 400);
        return fn();
    }
}

/**
 * 콥 자산을 페이지네이션 끝까지 받는다. 실패하면 null(부분 성공 없음 — 재고 숫자를
 * 반토막 낸 채로 기록하면 "부족" 오판정을 유발하므로 전부 못 받으면 이번 사이클은
 * 건너뛴다). 페이지별 요청은 재시도까지 다 실패해야 포기한다.
 *
 * @returns {Promise<{assets: object[], expiresAt: number|null} | null>} expiresAt은 응답
 *          Expires 헤더를 파싱한 epoch ms(페이지가 여럿이면 가장 이른 값) — 다음 동기화
 *          시각을 잡는 데 쓴다. 헤더가 없거나 파싱 실패하면 null(호출자가 폴백 간격을 씀).
 */
async function fetchAllCorpAssets(corporationId, accessToken) {
    const assets = [];
    let page = 1;
    let totalPages = 1;
    let expiresAt = null;

    do {
        const currentPage = page;
        const fetchPage = async () => {
            const res = await fetch(
                `${ESI_BASE}/corporations/${corporationId}/assets/?datasource=tranquility&page=${currentPage}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!res.ok) {
                const err = new Error(`[stock-sync] assets 조회 실패 status=${res.status}`);
                err.status = res.status;
                throw err;
            }
            return res;
        };

        let res;
        try {
            res = await withRetry(fetchPage);
        } catch {
            return null;
        }

        totalPages = Number(res.headers.get("x-pages") ?? 1) || 1;
        const expiresHeader = res.headers.get("expires");
        if (expiresHeader) {
            const parsed = Date.parse(expiresHeader);
            if (!Number.isNaN(parsed) && (expiresAt == null || parsed < expiresAt)) {
                expiresAt = parsed;
            }
        }
        assets.push(...(await res.json()));
        page += 1;
    } while (page <= totalPages);

    return { assets, expiresAt };
}

/**
 * structureId 아래 콥 행어(CorpSAG1~7) 안에 있는 아이템을 (typeId, division, 컨테이너)별로
 * 합산한다.
 *
 * CorpSAG 플래그는 상속된다 — 콥이 행어 안에 이름 붙인 컨테이너(예: "3.탄약")를
 * 넣어뒀으면, 그 컨테이너 자체는 flag가 CorpSAG4지만 그 안의 실제 탄약은
 * location_flag가 컨테이너 내용물 flag(예: Unlocked)로 나오고 division 정보가
 * 자기 자신한테는 없다 — 가장 가까운 조상의 CorpSAG flag를 그대로 물려받는다.
 * 실측 데이터로 확인됨: 구조물 → (오피스 등 중간 아이템) → CorpSAG6 → 실제 함선
 * 처럼 중간에 몇 단계가 끼어도 상관없이 동작해야 해서 깊이 제한 없이 BFS한다.
 *
 * containerItemId는 "내 바로 위 부모의 item_id"다 — 내 자신이 CorpSAG 플래그를
 * 갖고 있으면(= division에 직접 있음) null, 아니면 부모의 item_id를 그대로 쓴다.
 * division처럼 "첫 CorpSAG 매치 지점에서 고정해 쭉 물려주는" 방식이 아니다 — 그렇게
 * 하면 컨테이너 안에 또 컨테이너가 있는 2단 이상 중첩(실측 확인됨: 행어 하나 밑에
 * "PI"/"드론" 같은 이름 붙은 컨테이너가 한 단계 더 감싸여 있는 경우)에서 가장 안쪽
 * 아이템들이 진짜 자기 컨테이너가 아니라 가장 바깥 컨테이너의 item_id로 잘못
 * 태깅된다 — 그 이름으로 조회하면 "PI"가 아니라 바깥 컨테이너 이름이 나와서
 * StockDivisionRule 매칭이 조용히 실패한다(재고가 통째로 안 잡힘). 매 단계마다
 * 부모를 새로 넘기면 깊이와 무관하게 항상 "진짜 바로 위" 컨테이너가 나온다.
 * 나중에 이 item_id를 ESI assets/names로 조회하면 "드론"/"탄약" 같은 컨테이너
 * 이름을 알 수 있다(division/컨테이너별 추적 여부를 걸러내는 데 쓴다).
 *
 * 컨테이너 자체(예: "3.탄약" 아이템 그 자체)도 하나의 typeId로 같이 집계된다 —
 * 걸러내려면 아이템 카테고리를 추가 조회해야 하는데, 목표 재고를 안 잡아둔
 * typeId는 프론트에서 자연히 안 보이므로 굳이 거를 필요가 없다.
 *
 * is_singleton(함선처럼 개별 인스턴스가 의미 있는 아이템)이면 합산 키에 그 아이템
 * 자신의 item_id도 같이 섞는다 — 안 그러면 같은 컨테이너 안 다른 함선 두 대가
 * BFS의 visited/합산 로직 때문에 이름을 알기도 전에 하나로 뭉쳐져 버린다. 그래서
 * 반환 행에 itemId(싱글톤이면 자기 자신의 item_id, 아니면 null)를 같이 준다 —
 * 커스텀명은 아직 모르니(별도 ESI 호출 필요) 여기서는 인스턴스 단위로만 쪼개
 * 놓고, syncStructure가 이름을 조회한 뒤 "같은 이름이면 다시 합치는" 단계를
 * 따로 한다.
 *
 * @param {bigint | number | string} structureId
 * @param {{item_id:number, type_id:number, location_id:number, location_flag:string, quantity:number, is_singleton?:boolean}[]} assets
 * @returns {{typeId:number, division:number, containerItemId:number|null, quantity:number, itemId:number|null}[]}
 */
export function aggregateHangarStock(structureId, assets) {
    const childrenByParent = new Map();
    for (const a of assets) {
        const key = String(a.location_id);
        if (!childrenByParent.has(key)) childrenByParent.set(key, []);
        childrenByParent.get(key).push(a);
    }

    const stockByKey = new Map(); // "typeId|division|containerItemId|itemId" → 합산 항목
    const visited = new Set();
    let frontier = (childrenByParent.get(String(structureId)) ?? []).map((item) => ({
        item,
        division: CORPSAG_FLAG_RE.test(item.location_flag) ? item.location_flag : null,
        parentItemId: null, // 구조물/오피스 자체는 "컨테이너"로 취급하지 않는다
    }));

    while (frontier.length > 0) {
        const next = [];
        for (const { item, division, parentItemId } of frontier) {
            if (visited.has(item.item_id)) continue;
            visited.add(item.item_id);

            const isDivisionRoot = CORPSAG_FLAG_RE.test(item.location_flag);
            const containerItemId = isDivisionRoot ? null : parentItemId;

            if (division) {
                const divisionNumber = Number(division.replace("CorpSAG", ""));
                const singletonItemId = item.is_singleton === true ? item.item_id : null;
                const key = [item.type_id, divisionNumber, containerItemId, singletonItemId].join(
                    "|"
                );
                const existing = stockByKey.get(key);
                if (existing) {
                    existing.quantity += item.quantity;
                } else {
                    stockByKey.set(key, {
                        typeId: item.type_id,
                        division: divisionNumber,
                        containerItemId,
                        quantity: item.quantity,
                        itemId: singletonItemId,
                    });
                }
            }

            for (const child of childrenByParent.get(String(item.item_id)) ?? []) {
                const isChildDivisionRoot = CORPSAG_FLAG_RE.test(child.location_flag);
                // 컨테이너 내용물(Unlocked)이나 division 루트가 아니면 함선/구조물에
                // "장착"된 것이다(HiSlot·MedSlot·LoSlot·RigSlot·Cargo·DroneBay 등 피팅·화물
                // 슬롯) — 실측 확인됨: 이런 아이템은 is_singleton:true라도 ESI가 "이름
                // 지정 가능한 아이템"으로 안 쳐서, item_id 하나가 getAssetNames 배치에
                // 섞이면 그 청크(최대 200개) 전체가 404로 통째로 거부된다. 그 청크에
                // 우연히 같이 묶인 진짜 이름 붙은 함선들까지 전부 이름을 잃어버렸었다
                // (재시도해도 똑같은 요청을 그대로 다시 보내는 거라 안 고쳐짐). 어차피
                // containerName 추적 규칙이 있을 수 없어 isTracked에서 항상 걸러지던
                // 대상이라, 아예 여기서 더 내려가지 않아도 최종 재고 결과는 그대로다.
                if (!isChildDivisionRoot && child.location_flag !== "Unlocked") continue;

                const inheritedDivision = isChildDivisionRoot ? child.location_flag : division;
                next.push({
                    item: child,
                    division: inheritedDivision,
                    parentItemId: item.item_id,
                });
            }
        }
        frontier = next;
    }

    return [...stockByKey.values()];
}

/**
 * 구조물 하나를 동기화한다: 토큰 확보 → 콥 자산 조회 → 콥행어 집계 → StockLog 기록.
 *
 * 반환값은 크론 루프 자체는 안 쓰지만(fire-and-forget), 등록 명령에서 "방금 등록한
 * 구조물이 실제로 몇 종류나 잡혔는지" 바로 보여주기 위해 결과를 알아야 해서 만든다.
 *
 * @param {{ prisma: import("@prisma/client").PrismaClient, structure: {structureId: bigint, corporationId: number}, anchorCharacterId: bigint, log: {info:Function, warn:Function} }} params
 * @returns {Promise<{ok:boolean, itemTypes?:number, reason?:string}>}
 */
export async function syncStructure({ prisma, structure, anchorCharacterId, log }) {
    const accessToken = await getAccessTokenForCharacter(prisma, anchorCharacterId, { log });
    if (!accessToken) {
        log.warn("[stock-sync] 토큰 없음, 구조물 스킵", {
            structureId: String(structure.structureId),
        });
        await scheduleNext(prisma, structure.structureId, null);
        return { ok: false, reason: "토큰 없음(만료/미등록)" };
    }

    const fetched = await fetchAllCorpAssets(structure.corporationId, accessToken);
    if (!fetched) {
        log.warn("[stock-sync] 콥 자산 조회 실패, 구조물 스킵", {
            structureId: String(structure.structureId),
        });
        await scheduleNext(prisma, structure.structureId, null);
        return { ok: false, reason: "콥 자산 조회 실패" };
    }
    const { assets, expiresAt } = fetched;

    const aggregated = aggregateHangarStock(structure.structureId, assets);

    // 컨테이너 이름과 함선(싱글톤) 이름을 한 번에 조회한다 — 둘 다 is_singleton
    // 아이템이라 같은 배치에 섞어도 안전하다(자산진단 명령에서 이미 검증된 패턴).
    const containerItemIds = aggregated.map((r) => r.containerItemId).filter((id) => id != null);
    const singletonItemIds = aggregated.map((r) => r.itemId).filter((id) => id != null);
    const { names, hadFailures: namesHadFailures } = await getAssetNames(
        accessToken,
        structure.corporationId,
        [...new Set([...containerItemIds, ...singletonItemIds])]
    );

    const rules = await prisma.stockDivisionRule.findMany({
        where: { structureId: structure.structureId },
    });

    const trackedEntries = aggregated
        .map((entry) => ({
            ...entry,
            containerName:
                entry.containerItemId != null ? (names.get(entry.containerItemId) ?? null) : null,
            itemName: entry.itemId != null ? (names.get(entry.itemId) ?? null) : null,
        }))
        .filter((entry) => isTracked(entry, rules));

    // 이름을 몰랐던 aggregateHangarStock 단계에서는 함선(is_singleton) 인스턴스가
    // 안 뭉쳐진 채로 나왔다 — 이제 이름을 알았으니 "같은 (typeId, division,
    // containerItemId, itemName)"끼리 다시 합친다. 커스텀명 없는 함선은
    // itemName이 둘 다 null이라 여기서 자연히 typeId 기준으로 뭉친다(일반
    // 소모품과 같은 느낌 — 이름을 안 붙였으면 그냥 "그 타입 몇 대"로 취급).
    // 이 join의 ""는 DB 쪽 sentinel(StockDivisionRule/StockTarget 스키마 주석
    // 참고)과 무관한, 그냥 이 함수 안에서만 쓰는 Map 키 문자열이다.
    const mergedByName = new Map();
    for (const entry of trackedEntries) {
        const key = [
            entry.typeId,
            entry.division,
            entry.containerItemId ?? "",
            entry.itemName ?? "",
        ].join("|");
        const existing = mergedByName.get(key);
        if (existing) {
            existing.quantity += entry.quantity;
        } else {
            mergedByName.set(key, {
                typeId: entry.typeId,
                division: entry.division,
                containerName: entry.containerName,
                itemName: entry.itemName,
                quantity: entry.quantity,
            });
        }
    }
    const finalEntries = [...mergedByName.values()];

    // 목표 수량을 안 잡아둔 함선(이름 있는 아이템)은 30일 이력을 안 쌓는다 — 실수로
    // 컨테이너/함선 이름을 잘못 넣었다가 나중에 고쳐도, 옛날 잘못된 이름의 기록이
    // 조회 창(30일)에서 자연히 빠질 때까지 유령처럼 계속 보이는 게 더 번거롭다는
    // 판단(사용자 확인). 목표를 잡아둔 함선/일반 소모품은 그대로 30일 누적 유지 —
    // 매 사이클마다 지우고 다시 쓸 대상만 딱 골라낸다.
    const targets = await prisma.stockTarget.findMany({
        where: { structureId: structure.structureId },
    });
    const targetKeys = new Set(targets.map((t) => `${t.typeId}::${t.itemName || ""}`));

    // 이 사이클에 이름 조회(getAssetNames)가 한 청크라도 실패했으면 아래 두 정리
    // 로직을 통째로 건너뛴다 — 실제로 겪은 사고: 이름 조회가 일시적으로 실패해서
    // 진짜 존재하는 함선이 이번만 itemName:null로 잡히면, "이번 사이클에 없다"고
    // 오판해서 그 함선의 30일 이력을 영구 삭제해 버릴 수 있었다. 이번 사이클에
    // 못 지운 유령은 다음(성공하는) 사이클에 지우면 되니, 지우지 않는 쪽의 비용이
    // 훨씬 싸다.
    if (namesHadFailures) {
        log.warn("[stock-sync] 이름 조회 일부 실패 — 이번 사이클은 유령 정리 스킵", {
            structureId: String(structure.structureId),
        });
    } else {
        const existingNamedCombos = await prisma.stockLog.findMany({
            where: { structureId: structure.structureId, itemName: { not: null } },
            select: { typeId: true, itemName: true },
            distinct: ["typeId", "itemName"],
        });
        const noTargetCombos = existingNamedCombos.filter(
            (c) => !targetKeys.has(`${c.typeId}::${c.itemName || ""}`)
        );
        if (noTargetCombos.length > 0) {
            await prisma.stockLog.deleteMany({
                where: {
                    structureId: structure.structureId,
                    OR: noTargetCombos.map((c) => ({ typeId: c.typeId, itemName: c.itemName })),
                },
            });
        }

        // 위 정리는 일부러 itemName이 있는 것만 본다 — 그걸 그냥 풀어버리면 탄약/모듈처럼
        // 원래부터 이름이 없는 일반 소모품(목표 안 잡아둔 게 흔함)까지 "매치 안 됨"으로
        // 걸려서 매 사이클 지워질 위험이 있다. 대신 "이 구조물에서 이름 붙은 채로 한 번
        // 이상 나타난 적 있는 typeId"만 별도로 좁혀서, 그 typeId의 itemName=null 기록도
        // 같은 방식으로 정리한다 — 조립 안 된(포장) 함선이 나중에 조립되면 그 typeId는
        // 더 이상 itemName=null로 안 나타나는데, 옛 null 기록이 "이 typeId만의 마지막
        // 관측값"으로 30일 내내 유령처럼 남아있던 문제(실측: 조립된 지 3일 지나서도 미조립
        // 1대가 계속 잡힘)를 막는다. 일반 소모품 typeId는 이름 붙은 적이 아예 없어서 이
        // 집합에 자동으로 안 걸린다.
        const shipTypeIds = new Set([
            ...existingNamedCombos.map((c) => c.typeId),
            ...finalEntries.filter((e) => e.itemName != null).map((e) => e.typeId),
        ]);
        if (shipTypeIds.size > 0) {
            const existingNullCombos = await prisma.stockLog.findMany({
                where: {
                    structureId: structure.structureId,
                    itemName: null,
                    typeId: { in: [...shipTypeIds] },
                },
                select: { typeId: true },
                distinct: ["typeId"],
            });
            const currentNullTypeIds = new Set(
                finalEntries.filter((e) => e.itemName == null).map((e) => e.typeId)
            );
            const staleNullTypeIds = existingNullCombos
                .map((c) => c.typeId)
                .filter((typeId) => !currentNullTypeIds.has(typeId));
            if (staleNullTypeIds.length > 0) {
                await prisma.stockLog.deleteMany({
                    where: {
                        structureId: structure.structureId,
                        itemName: null,
                        typeId: { in: staleNullTypeIds },
                    },
                });
            }
        }
    }

    const sampledAt = new Date();
    if (finalEntries.length > 0) {
        await prisma.stockLog.createMany({
            data: finalEntries.map(({ typeId, division, containerName, itemName, quantity }) => ({
                structureId: structure.structureId,
                typeId,
                division,
                containerName,
                itemName,
                quantity,
                sampledAt,
            })),
        });
    }

    await scheduleNext(prisma, structure.structureId, expiresAt);

    log.info("[stock-sync] 동기화 완료", {
        structureId: String(structure.structureId),
        itemTypes: finalEntries.length,
        excludedCount: aggregated.length - trackedEntries.length,
        nextSyncAt: new Date(nextSyncAt.get(String(structure.structureId))).toISOString(),
    });

    return { ok: true, itemTypes: finalEntries.length };
}

/**
 * 재고 동기화 tick 등록. 5분마다 TrackedStructure(active=true) 전부를 순회하되,
 * 구조물별로 저장된 nextSyncAt(직전 동기화의 ESI Expires 헤더 기반)이 지나야 실제로
 * 동기화한다 — 매시 정각 고정이 아니라 구조물마다 캐시가 실제로 갱신되는 시점에 맞춘다. 각
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

    const task = cron.schedule(TICK_SCHEDULE, async () => {
        if (signal?.aborted) return;

        const structures = await prisma.trackedStructure.findMany({ where: { active: true } });
        if (structures.length === 0) return;

        const anchors = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS);
        const now = Date.now();

        for (const structure of structures) {
            if (signal?.aborted) return;
            // 아직 Expires 기준 다음 동기화 시각이 안 됐으면 이번 tick은 건너뛴다.
            // 맵에 없으면(최초 실행/재시작 직후) 0이라 바로 통과 — "모르니 일단 확인".
            const due = nextSyncAt.get(String(structure.structureId)) ?? 0;
            if (now < due) continue;

            const anchor = anchors.find((a) => a.corporationId === structure.corporationId);
            if (!anchor) {
                logInstance.warn("[stock-sync] EVE_ANCHOR_CHARIDS에 해당 콥 앵커 없음", {
                    tenantKey,
                    corporationId: structure.corporationId,
                    structureId: String(structure.structureId),
                });
                await scheduleNext(prisma, structure.structureId, null);
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
                await scheduleNext(prisma, structure.structureId, null);
            }
        }
    });

    if (signal) {
        signal.addEventListener("abort", () => task.stop(), { once: true });
    }

    logInstance.info(
        "[stock-sync] 재고 동기화 tick 등록 완료 (5분마다 점검, 구조물별 실제 동기화 주기는 ESI Expires 기준)"
    );
}
