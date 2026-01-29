import { logger } from "@bonsai/shared";

const log = logger();

let _map;

/**
 * DISCORD_TENANT_MAP을 1회 파싱해서 캐시한다.
 * 포맷: "channelId:tenantKey,channelId:tenantKey"
 * 예: "1462754270406377482:CAT,1462754292573278218:FISH"
 *
 * @returns {Map<string, string>} channelId -> tenantKey
 */
export function getTenantChannelMap() {
    if (_map) return _map;

    const raw = process.env.DISCORD_TENANT_MAP ?? "";
    const map = new Map();

    if (!raw.trim()) {
        log.warn("[tenant] DISCORD_TENANT_MAP이 빔");
        _map = map;
        return _map;
    }

    for (const chunk of raw.split(",")) {
        const part = chunk.trim();
        if (!part) continue;

        const idx = part.indexOf(":");
        if (idx <= 0 || idx === part.length - 1) {
            log.error(`[tenant] DISCORD_TENANT_MAP 항목 형식 이상: "${part}"`);
            continue;
        }

        const channelId = part.slice(0, idx).trim();
        const tenantKey = part.slice(idx + 1).trim();

        if (!channelId || !tenantKey) {
            log.error(`[tenant] DISCORD_TENANT_MAP 항목 누락: "${part}"`);
            continue;
        }

        map.set(channelId, tenantKey);
    }

    log.info(`[tenant] DISCORD_TENANT_MAP 로드 완료 count=${map.size}`);
    _map = map;
    return _map;
}

/**
 * channelId로 tenantKey를 조회한다.
 * @param {string} channelId
 * @returns {string|null}
 */
export function resolveTenantKey(channelId) {
    const map = getTenantChannelMap();
    return map.get(String(channelId)) ?? null;
}
