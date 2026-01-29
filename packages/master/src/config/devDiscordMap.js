import { logger } from "@bonsai/shared";

const log = logger();

let _map;

/**
 * DEV_DISCORD_MAP을 1회 파싱해서 캐시한다.
 * 포맷: "discordId:targetDev,discordId:targetDev"
 * 예: "339017884703653888:hasjun041215,378543198953406464:17328rm"
 *
 * @returns {Map<string, string>} discordUserId -> targetDev
 */
export function getDevDiscordMap() {
    if (_map) return _map;

    const raw = process.env.DEV_DISCORD_MAP ?? "";
    const map = new Map();

    if (!raw.trim()) {
        log.warn("[dev] DEV_DISCORD_MAP이 비어있음");
        _map = map;
        return _map;
    }

    for (const chunk of raw.split(",")) {
        const part = chunk.trim();
        if (!part) continue;

        const idx = part.indexOf(":");
        if (idx <= 0 || idx === part.length - 1) {
            log.error(`[dev] DEV_DISCORD_MAP 항목 형식 이상: "${part}"`);
            continue;
        }

        const discordUserId = part.slice(0, idx).trim();
        const targetDev = part.slice(idx + 1).trim();

        if (!discordUserId || !targetDev) {
            log.error(`[dev] DEV_DISCORD_MAP 항목 누락: "${part}"`);
            continue;
        }

        map.set(discordUserId, targetDev);
    }

    log.info(`[dev] DEV_DISCORD_MAP 로드 완료 count=${map.size}`);
    _map = map;
    return _map;
}

/**
 * 디스코드 유저ID로 targetDev를 조회한다.
 * @param {string} discordUserId
 * @returns {string|null}
 */
export function resolveTargetDev(discordUserId) {
    const map = getDevDiscordMap();
    return map.get(String(discordUserId)) ?? null;
}
