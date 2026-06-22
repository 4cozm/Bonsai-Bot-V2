// packages/worker/src/pajama/tokenHealth.js
//
// 모니터링용 토큰 취득 + 영구 장애 판정.
//
// 토큰 취득이 연속 N회(PAJAMA_TOKEN_FAIL_THRESHOLD, 기본 3) 실패하면 해당 캐릭터를
// "영구 장애"(폐기된 refresh_token, 미등록 등)로 간주하고 모든 잠옷 상태에서 퇴출한다.
// 성공하면 카운터를 리셋하므로, 일시적 실패(SSO 5xx 등)는 임계치에 도달하기 전에 회복된다.
//
// [전역 장애 가드]
//   SSO가 통째로 다운되면 모든 캐릭터가 동시에 실패해 대량 퇴출될 수 있다.
//   "최근 PAJAMA_TOKEN_SUCCESS_WINDOW_MS(기본 2분) 이내에 토큰 성공 이력이 있을 때만"
//   퇴출을 허용하여, 전역 장애 중에는 퇴출을 보류한다.
//
import { getAccessTokenForCharacter, logger } from "@bonsai/shared";

const log = logger();

const TOKEN_FAIL_THRESHOLD = Number(process.env.PAJAMA_TOKEN_FAIL_THRESHOLD ?? 3);
const RECENT_SUCCESS_WINDOW_MS = Number(
    process.env.PAJAMA_TOKEN_SUCCESS_WINDOW_MS ?? 2 * 60 * 1000
);

// 모듈 전역: 마지막으로 토큰 취득에 성공한 시각 (전역 장애 판별용).
let lastSuccessAt = 0;

/**
 * 모니터링용 accessToken 취득. 연속 실패 누적 시 캐릭터를 모니터링 대상에서 퇴출.
 *
 * @param {{ prisma: object, state: ReturnType<import("./state.js").makePajamaState>, charId: string|number|bigint }} opts
 * @returns {Promise<string|null>} accessToken 또는 실패 시 null
 */
export async function getMonitorToken({ prisma, state, charId }) {
    let token = null;
    try {
        token = await getAccessTokenForCharacter(prisma, BigInt(charId));
    } catch (err) {
        // 네트워크 예외 등 → 일시 실패로 취급(카운터만 증가)
        log.debug("[pajama:token] 토큰 취득 예외(일시)", {
            charId: String(charId),
            message: err?.message,
        });
    }

    if (token) {
        lastSuccessAt = Date.now();
        await state.clearTokenFail(charId);
        return token;
    }

    const fails = await state.bumpTokenFail(charId);
    const recentlyHealthy =
        lastSuccessAt > 0 && Date.now() - lastSuccessAt <= RECENT_SUCCESS_WINDOW_MS;

    if (fails >= TOKEN_FAIL_THRESHOLD && recentlyHealthy) {
        log.error("[pajama:token] 토큰 연속 실패 — 영구 장애 간주, 모니터링 대상에서 퇴출", {
            charId: String(charId),
            fails,
        });
        await state.purgeCharacter(charId);
    } else {
        // 임계치 미만이거나 전역 장애 의심 → 퇴출 보류
        log.debug("[pajama:token] 토큰 취득 실패", {
            charId: String(charId),
            fails,
            recentlyHealthy,
        });
    }
    return null;
}
