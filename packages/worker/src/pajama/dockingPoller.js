// packages/worker/src/pajama/dockingPoller.js
//
// 20초마다 실행.
// 온라인 리스트에서 도킹 리스트를 뺀 차집합(온라인이지만 아직 도킹 미확인 유저)의
// 현재 위치를 조회하여, 모니터링 스트럭쳐에 도킹 중이면 도킹 리스트에 추가.
//
import { logger } from "@bonsai/shared";
import { getCharacterLocation } from "./esiCalls.js";
import { makePajamaState } from "./state.js";
import { getMonitorToken } from "./tokenHealth.js";

const log = logger();
const POLL_INTERVAL_MS = 20 * 1000; // 20초

/**
 * 도킹 확인 1회 실행.
 *
 * @param {{ prisma: object, redis: object, tenantKey: string }} opts
 */
async function runDockingPoll({ prisma, redis, tenantKey }) {
    const state = makePajamaState(redis, tenantKey);

    const [onlineIds, dockingIds, structureIds] = await Promise.all([
        state.getMembers("online"),
        state.getMembers("docking"),
        state.getMembers("structures"),
    ]);

    if (onlineIds.length === 0 || structureIds.length === 0) return;

    const structureSet = new Set(structureIds.map(String));
    const dockingSet = new Set(dockingIds);

    // 온라인이지만 아직 도킹 미확인 유저 (차집합: online - docking)
    const unconfirmed = onlineIds.filter((id) => !dockingSet.has(id));
    if (unconfirmed.length === 0) return;

    const results = await Promise.allSettled(
        unconfirmed.map(async (charId) => {
            const token = await getMonitorToken({ prisma, state, charId });
            if (!token) return null;

            const location = await getCharacterLocation(token, charId);
            const structureId = location?.structure_id ? String(location.structure_id) : null;
            // log.info("[pajama:docking] 위치 조회 결과", { charId, structureId, station_id: location?.station_id ?? null });

            return structureId && structureSet.has(structureId) ? { charId, structureId } : null;
        })
    );

    const toAddToDocking = [];
    for (const [i, r] of results.entries()) {
        if (r.status === "rejected") {
            log.warn("[pajama:docking] 위치 조회 실패", {
                charId: unconfirmed[i],
                message: r.reason?.message,
            });
            continue;
        }
        if (r.value) {
            toAddToDocking.push(r.value);
        }
    }

    if (toAddToDocking.length > 0) {
        await state.addMembers(
            "docking",
            toAddToDocking.map((v) => v.charId)
        );
        log.info("[pajama:docking] 도킹 감지", {
            charIds: toAddToDocking.map((v) => v.charId),
            structureId: toAddToDocking[0]?.structureId,
        });
    }
}

/**
 * 도킹 폴러 시작 (20초 간격).
 *
 * @param {{ prisma: object, redis: object, tenantKey: string, signal?: AbortSignal }} opts
 */
export function startDockingPoller({ prisma, redis, tenantKey, signal }) {
    log.info("[pajama:docking] 도킹 폴러 시작 (20초 간격)");

    let timer = null;

    const schedule = () => {
        if (signal?.aborted) return;
        timer = setTimeout(async () => {
            try {
                await runDockingPoll({ prisma, redis, tenantKey });
            } catch (err) {
                log.warn("[pajama:docking] 폴 실패", { message: err?.message });
            } finally {
                schedule();
            }
        }, POLL_INTERVAL_MS);
    };

    schedule();

    if (signal) {
        signal.addEventListener(
            "abort",
            () => {
                if (timer) clearTimeout(timer);
            },
            { once: true }
        );
    }
}
