// packages/worker/src/pajama/index.js
//
// 잠옷(CA 임플란트) 알림 시스템 진입점.
//
// EVE_ANCHOR_CHARIDS 미설정 시 스트럭쳐 목록이 비어 있어 도킹/언독 감지 불가 (hot 분류만 동작).
//
import { logger } from "@bonsai/shared";
import { startDockingPoller } from "./dockingPoller.js";
import { startHotUserScheduler } from "./hotUserScheduler.js";
import { startOnlinePoller } from "./onlinePoller.js";
import { startTargetPoller } from "./targetPoller.js";

const log = logger();

/** CA 임플란트 typeID 목록 (하드코딩) */
const CA_TYPE_IDS = [2082, 2589, 33393, 33394];

/**
 * 잠옷 모니터 시작.
 *
 * @param {{ redis: object, prisma: object, tenantKey: string, signal?: AbortSignal }} opts
 */
export function startPajamaMonitor({ redis, prisma, tenantKey, signal }) {
    log.info(
        `[pajama] 잠옷 알림 시스템 시작 tenant=${tenantKey} caTypeIds=[${CA_TYPE_IDS.join(",")}]`
    );

    startHotUserScheduler({ prisma, redis, tenantKey, signal });
    startTargetPoller({ prisma, redis, tenantKey, caTypeIds: CA_TYPE_IDS, signal });
    startOnlinePoller({ prisma, redis, tenantKey, caTypeIds: CA_TYPE_IDS, signal });
    startDockingPoller({ prisma, redis, tenantKey, signal });
}
