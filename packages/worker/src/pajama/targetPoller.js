// packages/worker/src/pajama/targetPoller.js
//
// 10분마다 hot 리스트를 순회하여, 점프 클론 또는 활성 임플란트 중에
// CA 임플란트가 포함된 캐릭터만 target 리스트에 등록.
//
import { getAccessTokenForCharacter, logger } from "@bonsai/shared";
import {
    findCAImplantTypeId,
    getAllImplantsFromClones,
    getCharacterClones,
    getCharacterImplants,
} from "./esiCalls.js";
import { makePajamaState } from "./state.js";

const log = logger();
const POLL_INTERVAL_MS = Number(process.env.PAJAMA_TARGET_POLL_MS ?? 10 * 60 * 1000); // 기본 10분

/**
 * target 리스트 1회 갱신.
 *
 * @param {{ prisma: object, redis: object, tenantKey: string, caTypeIds: number[] }} opts
 */
async function runTargetPoll({ prisma, redis, tenantKey, caTypeIds }) {
    const state = makePajamaState(redis, tenantKey);
    const hotIds = await state.getList("hot");

    if (hotIds.length === 0) {
        await state.setList("target", []);
        return;
    }

    log.info(`[pajama:target] hot ${hotIds.length}명 대상으로 CA 임플 보유 여부 조회 시작`);

    const results = await Promise.allSettled(
        hotIds.map(async (charId) => {
            const token = await getAccessTokenForCharacter(prisma, BigInt(charId));
            if (!token) return null;

            const clonesData = await getCharacterClones(token, charId);
            const cloneImplants = getAllImplantsFromClones(clonesData);
            if (findCAImplantTypeId(cloneImplants, caTypeIds) !== null) return charId;

            const activeImplants = await getCharacterImplants(token, charId);
            if (findCAImplantTypeId(activeImplants ?? [], caTypeIds) !== null) return charId;

            return null;
        })
    );

    const targetIds = results
        .map((r, i) => {
            if (r.status === "rejected") {
                log.warn("[pajama:target] 캐릭터 임플 조회 실패", {
                    charId: hotIds[i],
                    message: r.reason?.message,
                });
                return null;
            }
            return r.value;
        })
        .filter(Boolean);

    await state.setList("target", targetIds);
    log.info(`[pajama:target] target 리스트 갱신 완료: ${targetIds.length}명`);
}

/**
 * 타겟 폴러 시작.
 *
 * @param {{ prisma: object, redis: object, tenantKey: string, caTypeIds: number[], signal?: AbortSignal }} opts
 */
export function startTargetPoller({ prisma, redis, tenantKey, caTypeIds, signal }) {
    log.info(`[pajama:target] 타겟 폴러 시작 (${POLL_INTERVAL_MS / 1000}초 간격)`);

    let timer = null;

    const schedule = () => {
        if (signal?.aborted) return;
        timer = setTimeout(async () => {
            try {
                await runTargetPoll({ prisma, redis, tenantKey, caTypeIds });
            } catch (err) {
                log.warn("[pajama:target] 폴 실패", { message: err?.message });
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
