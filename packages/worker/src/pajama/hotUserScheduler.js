// packages/worker/src/pajama/hotUserScheduler.js
//
// 매일 UTC 20:00 (KST 05:00) 실행.
//
// [핫 유저 분류]
// DB의 EveCharacter 테이블(봇에 ESI 등록된 캐릭터)을 기준으로,
// 각 캐릭터의 last_login이 30일 이내인 경우 hot 리스트에 등록.
//
// [스트럭쳐 분류]
// 앵커콥 토큰으로 콥 소속 스트럭쳐 목록 조회 및 저장.
//
// 환경변수:
//   PAJAMA_CHECK_HOUR   - UTC 기준 실행 시각 (기본: 20)
//   PAJAMA_CHECK_MINUTE - 실행 분 (기본: 0)
//
import { getAccessTokenForCharacter, logger, parseAnchorCharIds } from "@bonsai/shared";
import { getCorporationStructures } from "../esi/getCorporationStructures.js";
import { getCharacterOnline } from "./esiCalls.js";
import { makePajamaState } from "./state.js";

const log = logger();
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function scheduleDailyAt({ hour, minute, signal, fn }) {
    let timer = null;

    const arm = () => {
        if (signal?.aborted) return;

        const now = new Date(Date.now());
        const next = new Date(now);
        next.setUTCHours(hour, minute, 0, 0);
        if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

        const delay = Math.max(1_000, next.getTime() - now.getTime());
        timer = setTimeout(async () => {
            try {
                await fn();
            } finally {
                arm();
            }
        }, delay);
    };

    arm();

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

/**
 * 핫 유저 분류 + 스트럭쳐 목록 갱신 1회 실행.
 *
 * @param {{ prisma: object, redis: object, tenantKey: string }} opts
 */
async function runHotUserClassification({ prisma, redis, tenantKey }) {
    const state = makePajamaState(redis, tenantKey);

    // ── 1) DB에서 ESI 등록된 전체 캐릭터 조회 ──────────────────────────
    let allChars = [];
    try {
        allChars = await prisma.eveCharacter.findMany({ select: { characterId: true } });
    } catch (err) {
        log.warn("[pajama:hot] EveCharacter 조회 실패", { message: err?.message });
        return;
    }

    if (allChars.length === 0) {
        log.info("[pajama:hot] 등록된 캐릭터 없음 — hot 리스트 비움");
        await state.setList("hot", []);
        return;
    }

    log.info(`[pajama:hot] ESI 등록 캐릭터 ${allChars.length}명 대상으로 hot 분류 시작`);

    // ── 2) 각 캐릭터의 last_login 조회 → 30일 이내면 hot ────────────────
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const results = await Promise.allSettled(
        allChars.map(async ({ characterId }) => {
            const token = await getAccessTokenForCharacter(prisma, characterId);
            if (!token) return null;

            const onlineData = await getCharacterOnline(token, characterId);
            if (!onlineData?.last_login) return null;

            const lastLoginMs = new Date(onlineData.last_login).getTime();
            return lastLoginMs >= cutoff ? String(characterId) : null;
        })
    );

    const hotIds = results
        .map((r, i) => {
            if (r.status === "rejected") {
                log.warn("[pajama:hot] 캐릭터 온라인 조회 실패", {
                    characterId: String(allChars[i].characterId),
                    message: r.reason?.message,
                });
                return null;
            }
            return r.value;
        })
        .filter(Boolean);

    await state.setList("hot", hotIds);
    log.info(`[pajama:hot] hot 리스트 갱신 완료: ${hotIds.length}명`);

    // ── 3) 스트럭쳐 목록 갱신 ──────────────────────────────────────────
    // 테스트용: PAJAMA_TEST_STRUCTURE_IDS 설정 시 앵커콥 ESI 없이 고정값 사용
    const testStructureIds = (process.env.PAJAMA_TEST_STRUCTURE_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    if (testStructureIds.length > 0) {
        await state.setList("structures", testStructureIds);
        log.info(
            `[pajama:hot] 스트럭쳐 목록 갱신 완료 (테스트 고정값): ${testStructureIds.length}개 → [${testStructureIds.join(", ")}]`
        );
        return;
    }

    const anchorChars = parseAnchorCharIds(process.env.EVE_ANCHOR_CHARIDS ?? "");
    if (anchorChars.length === 0) {
        log.info("[pajama:hot] EVE_ANCHOR_CHARIDS 미설정 — 스트럭쳐 목록 비움");
        await state.setList("structures", []);
        return;
    }

    const structureIds = [];
    for (const { corporationId, characterId } of anchorChars) {
        try {
            const token = await getAccessTokenForCharacter(prisma, characterId);
            if (!token) continue;

            const structures = await getCorporationStructures(token, corporationId);
            if (!Array.isArray(structures)) continue;

            for (const s of structures) {
                const sid = String(s.structure_id ?? s.id ?? "");
                if (sid && !structureIds.includes(sid)) structureIds.push(sid);
            }
        } catch (err) {
            log.warn("[pajama:hot] 스트럭쳐 조회 실패", {
                corporationId,
                characterId: String(characterId),
                message: err?.message,
            });
        }
    }

    await state.setList("structures", structureIds);
    log.info(`[pajama:hot] 스트럭쳐 목록 갱신 완료: ${structureIds.length}개`);
}

/**
 * 핫 유저 스케줄러 시작.
 * - 부팅 시 1회 즉시 실행 후 매일 지정 시각(UTC)에 반복.
 *
 * @param {{ prisma: object, redis: object, tenantKey: string, signal?: AbortSignal }} opts
 */
/** 핫 유저 분류 실행 시각 — KST 05:00 = UTC 20:00 (하드코딩) */
const HOT_CHECK_HOUR = 20;
const HOT_CHECK_MINUTE = 0;

export function startHotUserScheduler({ prisma, redis, tenantKey, signal }) {
    const hour = HOT_CHECK_HOUR;
    const minute = HOT_CHECK_MINUTE;

    log.info(
        `[pajama:hot] 핫 유저 스케줄 등록 (매일 UTC ${hour}:${String(minute).padStart(2, "0")} / KST 05:00)`
    );

    // 부팅 시 즉시 1회 실행
    runHotUserClassification({ prisma, redis, tenantKey }).catch((err) =>
        log.warn("[pajama:hot] 초기 분류 실패", { message: err?.message })
    );

    scheduleDailyAt({
        hour,
        minute,
        signal,
        fn: () => runHotUserClassification({ prisma, redis, tenantKey }),
    });
}
