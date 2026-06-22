// packages/worker/src/pajama/onlinePoller.js
//
// 세 개의 독립 루프로 구성.
//
// [오프라인→온라인 감지] 5초 간격
//   target - online 차집합(오프라인 유저)을 대상으로 온라인 전환 감지.
//   온라인 확인 시 online 리스트에 추가. 모니터링 스트럭쳐 도킹이면 docking 리스트 추가.
//   (ESI /online/ 캐시 60초 → 이미 온라인인 유저를 5초마다 조회하는 건 낭비)
//
// [온라인 재확인] 60초 간격
//   online 리스트 전체를 재조회하여 오프라인 전환 유저를 online/docking 리스트에서 제거.
//
// [언독 감지] 5초 간격 (독립)
//   docking 리스트의 각 캐릭터 위치를 확인.
//   모니터링 스트럭쳐 밖이면 CA 임플란트 보유 여부 재확인 후 인게임 알림 창 팝업.
//
import { logger } from "@bonsai/shared";
import {
    findCAImplantTypeId,
    getCharacterImplants,
    getCharacterLocation,
    getCharacterOnline,
    openWindowNewMail,
} from "./esiCalls.js";
import { makePajamaState } from "./state.js";
import { getMonitorToken } from "./tokenHealth.js";

const log = logger();
const OFFLINE_CHECK_INTERVAL_MS = 5 * 1000; // 5초: 오프라인 유저 접속 감지
const ONLINE_REFRESH_INTERVAL_MS = 60 * 1000; // 60초: 온라인 유저 재확인
const UNDOCK_CHECK_INTERVAL_MS = 5 * 1000; // 5초: 언독 감지

function makeScheduler(label, intervalMs, fn, signal) {
    let timer = null;
    const schedule = () => {
        if (signal?.aborted) return;
        timer = setTimeout(async () => {
            try {
                await fn();
            } catch (err) {
                log.warn(`[pajama:online] ${label} 폴 실패`, { message: err?.message });
            } finally {
                schedule();
            }
        }, intervalMs);
    };
    schedule();
    signal?.addEventListener(
        "abort",
        () => {
            if (timer) clearTimeout(timer);
        },
        { once: true }
    );
}

// ── 오프라인→온라인 감지 (5초) ───────────────────────────────────────────────

async function runOfflineCheck({ prisma, redis, tenantKey }) {
    const state = makePajamaState(redis, tenantKey);

    const [targetIds, onlineIds, structureIds] = await Promise.all([
        state.getMembers("target"),
        state.getMembers("online"),
        state.getMembers("structures"),
    ]);

    const onlineSet = new Set(onlineIds);
    const offlineTargets = targetIds.filter((id) => !onlineSet.has(id));
    if (offlineTargets.length === 0) return;

    log.debug("[pajama:online] 오프라인 체크 진입", { targetIds, onlineIds, offlineTargets });

    const structureSet = new Set(structureIds.map(String));
    const dockingSnapshot = new Set(await state.getMembers("docking"));

    const results = await Promise.allSettled(
        offlineTargets.map(async (charId) => {
            const token = await getMonitorToken({ prisma, state, charId });
            if (!token) return null;

            const onlineData = await getCharacterOnline(token, charId);
            if (!onlineData?.online) return null;

            let addToDocking = null;
            if (!dockingSnapshot.has(charId)) {
                const location = await getCharacterLocation(token, charId);
                const structureId = location?.structure_id ? String(location.structure_id) : null;
                // log.info("[pajama:online] 위치 조회 결과", { charId, structureId, station_id: location?.station_id ?? null });
                if (structureId && structureSet.has(structureId)) addToDocking = structureId;
            }
            return { charId, addToDocking };
        })
    );

    const toAddToOnline = [];
    const toAddToDocking = [];
    for (const [i, r] of results.entries()) {
        if (r.status === "rejected") {
            log.warn("[pajama:online] 오프라인 체크 실패", {
                charId: offlineTargets[i],
                message: r.reason?.message,
            });
            continue;
        }
        if (!r.value) continue;
        const { charId, addToDocking } = r.value;
        toAddToOnline.push(charId);
        if (addToDocking) toAddToDocking.push({ charId, structureId: addToDocking });
    }

    if (toAddToOnline.length > 0) {
        await state.addMembers("online", toAddToOnline);
        log.info("[pajama:online] 온라인 전환 감지", { charIds: toAddToOnline });

        if (toAddToDocking.length > 0) {
            await state.addMembers(
                "docking",
                toAddToDocking.map((v) => v.charId)
            );
            log.info("[pajama:online] 도킹 감지", {
                charIds: toAddToDocking.map((v) => v.charId),
                structureId: toAddToDocking[0]?.structureId,
            });
        }
    }
}

// ── 온라인 유저 재확인 (60초) ─────────────────────────────────────────────────

async function runOnlineRefresh({ prisma, redis, tenantKey }) {
    const state = makePajamaState(redis, tenantKey);

    const onlineIds = await state.getMembers("online");

    if (onlineIds.length === 0) return;

    log.debug("[pajama:online] 온라인 재확인 시작", { onlineIds });

    const results = await Promise.allSettled(
        onlineIds.map(async (charId) => {
            // 토큰 실패: 일시면 유지, 영구(연속 실패)면 getMonitorToken이 이미 전체 퇴출 → 유지로 둬도 무방
            const token = await getMonitorToken({ prisma, state, charId });
            if (!token) return { charId, offline: false };

            const onlineData = await getCharacterOnline(token, charId);
            if (onlineData === null) {
                // ESI 일시 장애 → 온라인 유지 (거짓 오프라인 방지)
                log.debug("[pajama:online] ESI online 조회 실패(일시) — 유지", { charId });
                return { charId, offline: false };
            }

            log.debug("[pajama:online] 온라인 재확인 ESI 응답", {
                charId,
                online: onlineData.online,
            });
            return { charId, offline: onlineData.online !== true };
        })
    );

    // 확정 오프라인인 캐릭터만 online·docking에서 SREM (전체 덮어쓰기 금지 →
    // 그 사이 들어온 다른 루프의 SADD가 살아남아 lost update 방지).
    // 일시 실패(토큰/ESI/예외)는 유지하여 플래핑을 막는다.
    const toRemove = new Set();
    for (const [i, r] of results.entries()) {
        if (r.status === "rejected") {
            log.debug("[pajama:online] 온라인 재확인 예외(일시) — 유지", {
                charId: onlineIds[i],
                message: r.reason?.message,
            });
            continue;
        }
        if (r.value.offline) {
            log.info("[pajama:online] 오프라인 전환 감지", { charId: onlineIds[i] });
            toRemove.add(onlineIds[i]);
        }
    }

    log.debug("[pajama:online] 온라인 재확인 완료", {
        before: onlineIds,
        removed: [...toRemove],
    });
    if (toRemove.size > 0) {
        const removeIds = [...toRemove];
        await state.removeMembers("online", removeIds);
        await state.removeMembers("docking", removeIds);
    }
}

// ── 언독 감지 (5초) ───────────────────────────────────────────────────────────

async function runUndockCheck({ prisma, redis, tenantKey, caTypeIds }) {
    const state = makePajamaState(redis, tenantKey);

    const [dockingIds, structureIds] = await Promise.all([
        state.getMembers("docking"),
        state.getMembers("structures"),
    ]);

    if (dockingIds.length === 0) return;

    const structureSet = new Set(structureIds.map(String));

    const results = await Promise.allSettled(
        dockingIds.map(async (charId) => {
            const token = await getMonitorToken({ prisma, state, charId });
            if (!token) {
                // 일시 실패는 docking 유지, 영구면 getMonitorToken이 이미 퇴출
                log.debug("[pajama:online] 언독 체크 토큰 취득 실패 — docking 유지", { charId });
                return { charId, removeFromDocking: false, alert: null };
            }

            const location = await getCharacterLocation(token, charId);
            if (location === null) {
                log.warn("[pajama:online] 언독 체크 ESI 위치 조회 실패 — docking 유지", { charId });
                return { charId, removeFromDocking: false, alert: null };
            }
            const structureId = location.structure_id ? String(location.structure_id) : null;

            if (structureId && structureSet.has(structureId)) {
                return { charId, removeFromDocking: false, alert: null };
            }

            const activeImplants = await getCharacterImplants(token, charId);
            const caTypeId = findCAImplantTypeId(activeImplants ?? [], caTypeIds);

            return {
                charId,
                removeFromDocking: true,
                alert: caTypeId ? { token, caTypeId } : null,
            };
        })
    );

    // ESI 호출과 알림 전송은 병렬로, 변경할 charId만 수집
    const toRemoveFromDocking = new Set();

    await Promise.allSettled(
        results.map(async (r, i) => {
            if (r.status === "rejected") {
                log.warn("[pajama:online] 언독 체크 실패", {
                    charId: dockingIds[i],
                    message: r.reason?.message,
                });
                return;
            }
            const { charId, removeFromDocking, alert } = r.value;
            if (alert) {
                const sent = await openWindowNewMail(
                    alert.token,
                    charId,
                    "잠옷을 입고 언독하였습니다!!!",
                    "경고: CA 임플란트를 장착한 상태로 모니터링 스트럭쳐에서 언독하였습니다.<br><br>즉시 도킹하여 임플란트를 제거하거나 안전한 장소로 이동하십시오."
                );
                log.info("[pajama:online] 언독 알림 창 팝업", {
                    charId,
                    caTypeId: alert.caTypeId,
                    sent,
                });
            }
            if (removeFromDocking) toRemoveFromDocking.add(charId);
        })
    );

    // 언독/제거 대상만 원자적 SREM
    if (toRemoveFromDocking.size > 0) {
        await state.removeMembers("docking", [...toRemoveFromDocking]);
        log.info("[pajama:online] docking 리스트에서 제거", { charIds: [...toRemoveFromDocking] });
    }
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

/**
 * @param {{ prisma: object, redis: object, tenantKey: string, caTypeIds: number[], signal?: AbortSignal }} opts
 */
export function startOnlinePoller({ prisma, redis, tenantKey, caTypeIds, signal }) {
    log.info(
        "[pajama:online] 온라인 폴러 시작 — 오프라인감지 5초 / 온라인재확인 60초 / 언독감지 5초"
    );

    makeScheduler(
        "오프라인 체크",
        OFFLINE_CHECK_INTERVAL_MS,
        () => runOfflineCheck({ prisma, redis, tenantKey }),
        signal
    );
    makeScheduler(
        "온라인 재확인",
        ONLINE_REFRESH_INTERVAL_MS,
        () => runOnlineRefresh({ prisma, redis, tenantKey }),
        signal
    );
    makeScheduler(
        "언독 감지",
        UNDOCK_CHECK_INTERVAL_MS,
        () => runUndockCheck({ prisma, redis, tenantKey, caTypeIds }),
        signal
    );
}
