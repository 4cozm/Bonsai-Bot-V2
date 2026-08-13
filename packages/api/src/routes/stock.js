// packages/api/src/routes/stock.js
// 콥행어 재고 조회 GET 라우트. 백엔드는 typeId와 수치만 안다 — 이름/그룹/부피 같은
// "이 typeId가 실제로 뭔지"는 프론트가 공개 ESI(/universe/types 등)로 직접 붙여준다
// (ESI 패치로 이름이 바뀌어도 백엔드가 캐시 무효화를 신경 쓸 필요가 없어짐).

import express from "express";
import { getPrisma } from "@bonsai/shared/db";
import { requireSession } from "../auth/session.js";

const RECENT_HISTORY_HOURS = 25; // 스파크라인 24건 + 여유 1시간(크론 밀림 대비)
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

    // GET /v1/stock/structures/:structureId/items — 현재 재고 목록(+최근 24건 스파크라인용).
    router.get("/structures/:structureId/items", async (req, res) => {
        const structureId = parseBigIntParam(req.params.structureId);
        if (structureId == null) {
            return res.status(400).json({ ok: false, error: "structureId가 올바르지 않습니다." });
        }

        const prisma = getPrisma(req.session.tenantKey);
        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return res.status(404).json({ ok: false, error: "구조물을 찾을 수 없습니다." });
        }

        const since = new Date(Date.now() - RECENT_HISTORY_HOURS * 60 * 60 * 1000);
        const [logs, targets] = await Promise.all([
            prisma.stockLog.findMany({
                where: { structureId, sampledAt: { gte: since } },
                orderBy: { sampledAt: "asc" },
            }),
            prisma.stockTarget.findMany({ where: { structureId } }),
        ]);

        const targetByType = new Map(targets.map((t) => [t.typeId, t.targetQty]));

        const byType = new Map();
        for (const log of logs) {
            if (!byType.has(log.typeId)) byType.set(log.typeId, []);
            byType.get(log.typeId).push(log);
        }

        let latestSampledAt = null;
        const items = [...byType.entries()].map(([typeId, rows]) => {
            const recent = rows.slice(-RECENT_HISTORY_POINTS);
            const last = recent[recent.length - 1];
            if (!latestSampledAt || last.sampledAt > latestSampledAt) {
                latestSampledAt = last.sampledAt;
            }
            return {
                typeId,
                stocked: last.quantity,
                target: targetByType.get(typeId) ?? null,
                recentHistory: recent.map(toQuantityPoint),
            };
        });

        res.json({
            ok: true,
            structure: {
                structureId: String(structure.structureId),
                displayName: structure.displayName,
                syncedAt: latestSampledAt ? latestSampledAt.toISOString() : null,
            },
            items,
        });
    });

    // GET /v1/stock/structures/:structureId/items/:typeId/history?days=90 — 아이템 하나의 전체 이력(모달용, on-demand).
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

        const prisma = getPrisma(req.session.tenantKey);
        const structure = await prisma.trackedStructure.findUnique({ where: { structureId } });
        if (!structure) {
            return res.status(404).json({ ok: false, error: "구조물을 찾을 수 없습니다." });
        }

        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const logs = await prisma.stockLog.findMany({
            where: { structureId, typeId, sampledAt: { gte: since } },
            orderBy: { sampledAt: "asc" },
        });

        res.json({ ok: true, typeId, days, history: logs.map(toQuantityPoint) });
    });

    return router;
}
