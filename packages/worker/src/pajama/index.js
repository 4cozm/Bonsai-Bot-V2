// packages/worker/src/pajama/index.js
//
// 잠옷(CA 임플란트) 알림 시스템 진입점.
//
// CA_IMPLANT_TYPE_IDS 환경변수가 미설정이면 비활성화.
// EVE_ANCHOR_CHARIDS 미설정 시 스트럭쳐 목록이 비어 있어 도킹/언독 감지 불가 (hot 분류만 동작).
//
import { logger } from "@bonsai/shared";
import { startDockingPoller } from "./dockingPoller.js";
import { startHotUserScheduler } from "./hotUserScheduler.js";
import { startOnlinePoller } from "./onlinePoller.js";
import { startTargetPoller } from "./targetPoller.js";

const log = logger();

/**
 * CA_IMPLANT_TYPE_IDS 환경변수를 파싱하여 number[] 반환.
 * 미설정 또는 빈 값이면 null 반환.
 *
 * @returns {number[] | null}
 */
function parseCaTypeIds() {
    const raw = String(process.env.CA_IMPLANT_TYPE_IDS ?? "").trim();
    if (!raw) return null;
    const ids = raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    return ids.length > 0 ? ids : null;
}

/**
 * 잠옷 모니터 시작.
 *
 * @param {{ redis: object, prisma: object, tenantKey: string, signal?: AbortSignal }} opts
 */
export function startPajamaMonitor({ redis, prisma, tenantKey, signal }) {
    const caTypeIds = parseCaTypeIds();

    if (!caTypeIds) {
        log.info("[pajama] CA_IMPLANT_TYPE_IDS 미설정 — 잠옷 알림 시스템 비활성화");
        return;
    }

    log.info(
        `[pajama] 잠옷 알림 시스템 시작 tenant=${tenantKey} caTypeIds=[${caTypeIds.join(",")}]`
    );

    startHotUserScheduler({ prisma, redis, tenantKey, signal });
    startTargetPoller({ prisma, redis, tenantKey, caTypeIds, signal });
    startOnlinePoller({ prisma, redis, tenantKey, caTypeIds, signal });
    startDockingPoller({ prisma, redis, tenantKey, signal });
}
