// packages/master/src/usecases/handleAutocomplete.js
import { logger } from "@bonsai/shared";
import { randomUUID } from "node:crypto";
import { resolveTenantKey } from "../config/tenantChannelMap.js";

const log = logger();

const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 2500;

/**
 * Autocomplete interaction을 Worker로 전달하고 결과를 폴링으로 받아 반환한다.
 *
 * 흐름:
 * 1. channelId → tenantKey 라우팅
 * 2. RPUSH bonsai:ac:{tenantKey} {requestPayload}
 * 3. 50ms 간격으로 GET bonsai:ac:res:{requestId} 폴링 (최대 2.5초)
 * 4. 결과 파싱 후 반환 (타임아웃이면 빈 배열)
 *
 * @param {object} interaction - Discord autocomplete interaction
 * @param {object} deps
 * @param {import("redis").RedisClientType} deps.redis
 * @returns {Promise<Array<{name: string, value: string}>>}
 */
export async function handleAutocomplete(interaction, { redis }) {
    // #region agent log
    const _acStart = Date.now();
    log.warn(`[DEBUG:AC:M] handleAutocomplete 진입 t=${_acStart}`);
    // #endregion

    const channelId = String(interaction.channelId ?? "").trim();
    const tenantKey = resolveTenantKey(channelId);
    if (!tenantKey) {
        log.warn(`[autocomplete] 허용되지 않은 채널 channelId=${channelId}`);
        return [];
    }

    const commandName = String(interaction.commandName ?? "").trim();
    const discordUserId = String(interaction.user?.id ?? "").trim();
    const focusedValue = String(interaction.options?.getFocused?.() ?? "").trim();

    const requestId = randomUUID();
    const listKey = `bonsai:ac:${tenantKey}`;
    const resKey = `bonsai:ac:res:${requestId}`;

    // #region agent log
    log.warn(
        `[DEBUG:AC:M] RPUSH 시작 listKey=${listKey} reqId=${requestId} cmd=${commandName} H2:키확인`
    );
    // #endregion

    const payload = JSON.stringify({
        requestId,
        commandName,
        discordUserId,
        focusedValue,
    });

    await redis.rPush(listKey, payload);

    // #region agent log
    log.warn(`[DEBUG:AC:M] RPUSH 완료 elapsed=${Date.now() - _acStart}ms H1:RPUSH완료`);
    // #endregion

    // 폴링: Worker가 resKey에 결과를 SET하면 즉시 반환
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let _pollCount = 0;
    while (Date.now() < deadline) {
        const raw = await redis.get(resKey);
        _pollCount++;
        if (raw != null) {
            // #region agent log
            const _elapsed = Date.now() - _acStart;
            log.warn(
                `[DEBUG:AC:M] 폴링 히트! polls=${_pollCount} elapsed=${_elapsed}ms resKey=${resKey} rawLen=${raw.length} H3:타이밍`
            );
            // #endregion
            // 클린업
            redis.del(resKey).catch(() => {});
            try {
                const choices = JSON.parse(raw);
                return Array.isArray(choices) ? choices : [];
            } catch {
                return [];
            }
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // #region agent log
    log.warn(
        `[DEBUG:AC:M] 폴링 타임아웃! polls=${_pollCount} elapsed=${Date.now() - _acStart}ms resKey=${resKey} H3:타임아웃`
    );
    // #endregion

    log.warn(`[autocomplete] 타임아웃 tenant=${tenantKey} cmd=${commandName} reqId=${requestId}`);
    // 타임아웃 시 resKey 클린업(Worker가 늦게 쓸 수 있으므로)
    redis.del(resKey).catch(() => {});
    return [];
}
