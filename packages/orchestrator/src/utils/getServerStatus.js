import { logger } from "@bonsai/shared";

const log = logger();

/**
 * EVE Online(EVE ESI) 서버 상태 조회.
 * - datasource=tranquility 고정
 * - 네트워크 오류/비정상 응답은 예외로 올린다.
 */
export async function getServerStatus() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(
            "https://esi.evetech.net/latest/status/?datasource=tranquility",
            {
                signal: controller.signal,
                headers: { accept: "application/json" },
            }
        );

        if (!response.ok) {
            log.error(`[global:esi] ESI가 응답하지 않습니다 status=${response.status}`);
            throw new Error(`ESI status http ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}
