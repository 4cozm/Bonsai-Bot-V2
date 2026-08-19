// packages/api/src/routes/stock.js
// 콥행어 재고 조회 GET 라우트. 백엔드는 typeId와 수치만 안다 — 이름/그룹/부피 같은
// "이 typeId가 실제로 뭔지"는 프론트가 공개 ESI(/universe/types 등)로 직접 붙여준다
// (ESI 패치로 이름이 바뀌어도 백엔드가 캐시 무효화를 신경 쓸 필요가 없어짐).

import express from "express";
import { getPrisma } from "@bonsai/shared/db";
import { requireSession } from "../auth/session.js";
import { computeBurnRatePerDay, computeDaysLeft } from "../stock/burnRate.js";

// daysLeft 계산에 30일치가 필요해서(burnRate.js), 목록 조회 자체를 그 창으로
// 가져온다 — 스파크라인(최근 24건)은 이미 받아온 이 데이터의 꼬리만 잘라 쓰면
// 되니 쿼리를 두 번 안 날려도 된다.
const BURN_WINDOW_DAYS = 30;
const RECENT_HISTORY_POINTS = 24;
const DEFAULT_HISTORY_DAYS = 90;
const MAX_HISTORY_DAYS = 365;

function parseBigIntParam(raw) {
    const s = String(raw ?? "").trim();
    if (!/^\d+$/.test(s)) return null;
    try {
        return BigInt(s);
    } catch {
        return null;
    }
}

function toQuantityPoint(row) {
    return { sampledAt: row.sampledAt.toISOString(), quantity: row.quantity };
}

/**
 * typeId+itemName 조합의 그룹 키. StockLog.itemName은 "이름 없음"이 null이고
 * StockTarget.itemName은 "이름 없음"이 ""(스키마 주석 참고, MySQL 복합 유니크
 * 인덱스 제약 때문) — 표현이 다른 두 값을 이 함수 하나로만 정규화해서 키를 만든다.
 * 여기 말고 다른 곳에서 개별적으로 키를 조립하면(예: `typeId + itemName`처럼)
 * null과 "" 불일치로 일반(비함선) 품목의 목표 매칭이 조용히 깨진다.
 */
function nameKey(typeId, itemName) {
    return `${typeId}::${itemName || ""}`;
}

/**
 * 같은 typeId라도 division/컨테이너별로 별도 행(row)이라, 같은 sampledAt(한 동기화
 * 사이클은 항상 같은 timestamp)끼리 quantity를 합산해서 "그 시점의 typeId 총량"
 * 시계열로 되돌린다. division 필터가 없을 때는 원래 하나의 행이었던 것과 수학적으로
 * 동일한 결과가 나온다 — burnRate 계산 로직은 그대로 재사용한다.
 * @param {{sampledAt:Date, quantity:number}[]} rows 같은 typeId의 로그 행들
 * @returns {{sampledAt:Date, quantity:number}[]} sampledAt 오름차순
 */
function reconstructSeries(rows) {
    const byTime = new Map();
    for (const row of rows) {
        const key = row.sampledAt.getTime();
        byTime.set(key, (byTime.get(key) ?? 0) + row.quantity);
    }
    return [...byTime.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, quantity]) => ({ sampledAt: new Date(time), quantity }));
}

/**
 * @returns {import("express").Router}
 */
export function createStockRouter() {
    const router = express.Router();
    router.use(requireSession);

    // GET /v1/stock/structures — 추적 중인 구조물 목록.
    router.get("/structures", async (req, res) => {
        const prisma = getPrisma(req.session.tenantKey);
        const structures = await prisma.trackedStructure.findMany({
            where: { active: true },
            orderBy: { displayName: "asc" },
        });

        res.json({
            ok: true,
            structures: structures.map((s) => ({
                structureId: String(s.structureId),
                displayName: s.displayName,
            })),
        });
    });

    // GET /v1/stock/structures/:structureId/divisions — 이 구조물에 설정된 추적 대상
    // 행어/컨테이너 목록(관리자가 /재고행어설정으로 등록한 것 중 tracked:true만).
    // 한글 행어 이름을 프론트에 하드코딩하지 않고 이 목록으로 선택 UI를 채운다.
    router.get("/structures/:structureId/divisions", async (req, res) => {
        const structureId = parseBigIntParam(req.params.structureId);
        if (structureId == null) {
            return res.status(400).json({ ok: false, error: "structureId가 올바르지 않습니다." });
        }

        const prisma = getPrisma(req.session.tenantKey);
        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return res.status(404).json({ ok: false, error: "구조물을 찾을 수 없습니다." });
        }

        const rules = await prisma.stockDivisionRule.findMany({
            where: { structureId, tracked: true },
            orderBy: [{ division: "asc" }, { containerName: "asc" }],
        });

        res.json({
            ok: true,
            // DB의 ""(division 전체 규칙 자리표시자, StockDivisionRule 스키마 주석 참고)를
            // 밖으로 그대로 흘려보내지 않는다 — API 소비자 입장에선 "값 없음"은 null이 맞다.
            divisions: rules.map((r) => ({
                division: r.division,
                containerName: r.containerName || null,
                displayName: r.displayName,
            })),
        });
    });

    // GET /v1/stock/structures/:structureId/items — 현재 재고 목록(+최근 24건 스파크라인용).
    // ?division=4&container=드론 으로 특정 행어/컨테이너에 있는 typeId만 좁힐 수 있다
    // (target/deficit은 여전히 구조물 전체 기준 — 필터는 "어디 있는 typeId를 보여줄지"만 좁힌다).
    router.get("/structures/:structureId/items", async (req, res) => {
        const structureId = parseBigIntParam(req.params.structureId);
        if (structureId == null) {
            return res.status(400).json({ ok: false, error: "structureId가 올바르지 않습니다." });
        }

        let division = null;
        if (req.query?.division != null && String(req.query.division).trim() !== "") {
            division = Number(req.query.division);
            if (!Number.isInteger(division)) {
                return res.status(400).json({ ok: false, error: "division이 올바르지 않습니다." });
            }
        }
        const container =
            typeof req.query?.container === "string" && req.query.container.trim()
                ? req.query.container.trim()
                : null;

        const prisma = getPrisma(req.session.tenantKey);
        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return res.status(404).json({ ok: false, error: "구조물을 찾을 수 없습니다." });
        }

        const since = new Date(Date.now() - BURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        // division/container 필터를 SQL WHERE로 직접 내린다 — 예전엔 30일치 전체를
        // 다 긁어온 뒤 JS에서 걸러냈는데, 아이템 수가 많은 구조물(실측: 30일치
        // 17만 행)에서 특정 행어만 볼 때도 항상 전체를 읽어야 해서 느렸다(EXPLAIN
        // ANALYZE로 확인: SQL 자체는 1.5초로 인덱스 잘 타지만, 그 많은 행을 Node로
        // 옮겨서 그룹핑·burn rate 계산까지 하는 게 진짜 병목). division을 주면
        // (structureId, division, sampledAt) 인덱스를 그대로 타서 filesort도
        // 없어질 가능성이 높다 — 정렬 키가 이미 인덱스 순서와 맞기 때문.
        const [logs, targets] = await Promise.all([
            prisma.stockLog.findMany({
                where: {
                    structureId,
                    sampledAt: { gte: since },
                    ...(division != null && { division }),
                    ...(container != null && { containerName: container }),
                },
                orderBy: { sampledAt: "asc" },
            }),
            prisma.stockTarget.findMany({ where: { structureId } }),
        ]);

        const targetByKey = new Map(
            targets.map((t) => [nameKey(t.typeId, t.itemName), t.targetQty])
        );

        // typeId만으론 부족하다 — 같은 typeId라도 함선처럼 개별 이름(itemName)이
        // 다르면 서로 다른 품목으로 취급해야 한다(같은 이름끼리는 이미 동기화
        // 단계에서 합쳐져서 로그에 한 묶음으로 들어옴).
        const byKey = new Map();
        for (const log of logs) {
            const key = nameKey(log.typeId, log.itemName);
            if (!byKey.has(key))
                byKey.set(key, { typeId: log.typeId, itemName: log.itemName, rows: [] });
            byKey.get(key).rows.push(log);
        }

        let latestSampledAt = null;
        const items = [...byKey.values()].map(({ typeId, itemName, rows }) => {
            const series = reconstructSeries(rows);
            const last = series[series.length - 1];
            if (!latestSampledAt || last.sampledAt > latestSampledAt) {
                latestSampledAt = last.sampledAt;
            }
            const burnRatePerDay = computeBurnRatePerDay(series, BURN_WINDOW_DAYS);
            return {
                typeId,
                itemName,
                stocked: last.quantity,
                target: targetByKey.get(nameKey(typeId, itemName)) ?? null,
                daysLeft: computeDaysLeft(last.quantity, burnRatePerDay),
                recentHistory: series.slice(-RECENT_HISTORY_POINTS).map(toQuantityPoint),
            };
        });

        res.json({
            ok: true,
            structure: {
                structureId: String(structure.structureId),
                displayName: structure.displayName,
                syncedAt: latestSampledAt ? latestSampledAt.toISOString() : null,
                // 워커가 직전 동기화 시도의 ESI Expires 헤더로 매번 갱신하는 값(없으면
                // 1시간 폴백) — 실제 동기화 타이밍을 이 값이 결정하진 않는다(워커는
                // 별도 인메모리 스케줄을 씀), 프론트 "다음 동기화 N분 후" 표시 전용.
                nextSyncAt: structure.nextSyncAt ? structure.nextSyncAt.toISOString() : null,
            },
            items,
        });
    });

    // PATCH /v1/stock/structures/:structureId/targets — 목표 수량 저장/삭제.
    // body: { typeId, itemName?, targetQty }. targetQty<=0이면 "추적 안 함"으로
    // 되돌리는 것이므로 행을 지운다(프론트 hasNoTarget()의 target=0 취급과 대응).
    router.patch("/structures/:structureId/targets", async (req, res) => {
        const structureId = parseBigIntParam(req.params.structureId);
        if (structureId == null) {
            return res.status(400).json({ ok: false, error: "structureId가 올바르지 않습니다." });
        }

        const typeId = Number(req.body?.typeId);
        if (!Number.isInteger(typeId) || typeId <= 0) {
            return res.status(400).json({ ok: false, error: "typeId가 올바르지 않습니다." });
        }
        const targetQtyRaw = Number(req.body?.targetQty);
        if (!Number.isFinite(targetQtyRaw)) {
            return res.status(400).json({ ok: false, error: "targetQty가 올바르지 않습니다." });
        }
        const targetQty = Math.floor(targetQtyRaw);
        // ""(빈 문자열) = 일반 품목. StockTarget.itemName 스키마 주석 참고.
        const itemName = String(req.body?.itemName ?? "").trim();

        const prisma = getPrisma(req.session.tenantKey);
        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return res.status(404).json({ ok: false, error: "구조물을 찾을 수 없습니다." });
        }

        if (targetQty <= 0) {
            // delete()가 아니라 deleteMany() — 삭제 대상 행이 이미 없어도(동시 편집,
            // 재시도 등) 에러 없이 성공으로 끝나야 여러 건을 한 번에 저장할 때 하나
            // 실패했다고 나머지까지 실패 처리되는 일이 없다.
            await prisma.stockTarget.deleteMany({ where: { structureId, typeId, itemName } });
        } else {
            await prisma.stockTarget.upsert({
                where: { structureId_typeId_itemName: { structureId, typeId, itemName } },
                create: { structureId, typeId, itemName, targetQty },
                update: { targetQty },
            });
        }

        res.json({ ok: true });
    });

    // GET /v1/stock/structures/:structureId/fittings — 이 구조물에 저장된 피팅 전부.
    // 커스텀명 있는 함선만 대상이라 개수가 적어서, 모달/매니페스트를 열 때마다 개별
    // 조회하지 않고 구조물 로드 시 한 번만 받아 프론트가 들고 있는다.
    router.get("/structures/:structureId/fittings", async (req, res) => {
        const structureId = parseBigIntParam(req.params.structureId);
        if (structureId == null) {
            return res.status(400).json({ ok: false, error: "structureId가 올바르지 않습니다." });
        }

        const prisma = getPrisma(req.session.tenantKey);
        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return res.status(404).json({ ok: false, error: "구조물을 찾을 수 없습니다." });
        }

        const fittings = await prisma.shipFitting.findMany({ where: { structureId } });
        res.json({
            ok: true,
            fittings: fittings.map((f) => ({
                typeId: f.typeId,
                itemName: f.itemName,
                items: f.items,
                updatedAt: f.updatedAt.toISOString(),
            })),
        });
    });

    // PATCH /v1/stock/structures/:structureId/fittings — 피팅 저장/삭제.
    // body: { typeId, itemName, items: [{typeId, qty}] }. items가 비어있으면(길이 0)
    // "피팅 없음"으로 되돌리는 것이므로 행을 지운다. 존재 검증(프론트가 ESI
    // POST /universe/ids/로 이미 확인)은 여기서 다시 안 한다 — 형태만 본다.
    router.patch("/structures/:structureId/fittings", async (req, res) => {
        const structureId = parseBigIntParam(req.params.structureId);
        if (structureId == null) {
            return res.status(400).json({ ok: false, error: "structureId가 올바르지 않습니다." });
        }

        const typeId = Number(req.body?.typeId);
        if (!Number.isInteger(typeId) || typeId <= 0) {
            return res.status(400).json({ ok: false, error: "typeId가 올바르지 않습니다." });
        }
        const itemName = String(req.body?.itemName ?? "").trim();
        if (!itemName) {
            return res.status(400).json({ ok: false, error: "itemName이 필요합니다." });
        }

        const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!itemsRaw) {
            return res.status(400).json({ ok: false, error: "items가 올바르지 않습니다." });
        }
        const items = [];
        for (const raw of itemsRaw) {
            const itemTypeId = Number(raw?.typeId);
            const qty = Number(raw?.qty);
            const valid =
                Number.isInteger(itemTypeId) && itemTypeId > 0 && Number.isInteger(qty) && qty > 0;
            if (!valid) {
                return res
                    .status(400)
                    .json({ ok: false, error: "items 항목이 올바르지 않습니다." });
            }
            items.push({ typeId: itemTypeId, qty });
        }

        const prisma = getPrisma(req.session.tenantKey);
        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return res.status(404).json({ ok: false, error: "구조물을 찾을 수 없습니다." });
        }

        if (items.length === 0) {
            // delete()가 아니라 deleteMany() — /targets와 같은 이유(삭제 대상이 이미
            // 없어도 에러 없이 성공으로 끝나야 함).
            await prisma.shipFitting.deleteMany({ where: { structureId, typeId, itemName } });
        } else {
            await prisma.shipFitting.upsert({
                where: { structureId_typeId_itemName: { structureId, typeId, itemName } },
                create: { structureId, typeId, itemName, items },
                update: { items },
            });
        }

        res.json({ ok: true });
    });

    // GET /v1/stock/structures/:structureId/items/:typeId/history?days=90&itemName=
    // — 아이템 하나의 전체 이력(모달용, on-demand). itemName이 있으면 그 이름의
    // 함선 이력만(없으면 같은 typeId의 다른 이름 함선들 이력까지 섞여 나온다 —
    // 목록에서 이미 이름별로 나뉜 행을 클릭해서 여는 모달이라 필수).
    router.get("/structures/:structureId/items/:typeId/history", async (req, res) => {
        const structureId = parseBigIntParam(req.params.structureId);
        const typeId = Number(req.params.typeId);
        if (structureId == null || !Number.isInteger(typeId) || typeId <= 0) {
            return res
                .status(400)
                .json({ ok: false, error: "structureId 또는 typeId가 올바르지 않습니다." });
        }

        const daysRaw = Number(req.query?.days);
        const days = Number.isFinite(daysRaw)
            ? Math.min(MAX_HISTORY_DAYS, Math.max(1, Math.floor(daysRaw)))
            : DEFAULT_HISTORY_DAYS;
        const itemName =
            typeof req.query?.itemName === "string" && req.query.itemName.trim()
                ? req.query.itemName.trim()
                : null;

        const prisma = getPrisma(req.session.tenantKey);
        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return res.status(404).json({ ok: false, error: "구조물을 찾을 수 없습니다." });
        }

        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const logs = await prisma.stockLog.findMany({
            where: {
                structureId,
                typeId,
                sampledAt: { gte: since },
                ...(itemName != null ? { itemName } : {}),
            },
            orderBy: { sampledAt: "asc" },
        });

        res.json({ ok: true, typeId, days, history: logs.map(toQuantityPoint) });
    });

    return router;
}
