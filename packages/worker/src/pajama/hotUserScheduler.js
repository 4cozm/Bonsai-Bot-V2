// packages/worker/src/pajama/hotUserScheduler.js
//
// "잠옷-핫유저-분류" 커맨드 핸들러 로직.
// 실행 타이밍은 글로벌 오케스트레이터(pajamaHotScheduler)가 제어한다:
//   - 오케스트레이터 시작 시 즉시 1회 발행
//   - 이후 매일 KST 05:00 (UTC 20:00) 반복 발행
//
// [핫 유저 분류]
// DB의 EveCharacter 테이블(봇에 ESI 등록된 캐릭터)을 기준으로,
// 각 캐릭터의 last_login이 30일 이내인 경우 hot 리스트에 등록.
//
// [스트럭쳐 분류]
// 앵커콥 토큰으로 콥 소속 스트럭쳐 목록 조회 및 저장.
//
import { getAccessTokenForCharacter, logger, parseAnchorCharIds } from "@bonsai/shared";
import { getCorporationStructures } from "../esi/getCorporationStructures.js";
import { getCharacterOnline } from "./esiCalls.js";
import { makePajamaState } from "./state.js";

const log = logger();
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 핫 유저 분류 + 스트럭쳐 목록 갱신 1회 실행.
 *
 * @param {{ prisma: object, redis: object, tenantKey: string }} opts
 */
export async function runHotUserClassification({ prisma, redis, tenantKey }) {
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

