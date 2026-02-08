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

    const payload = JSON.stringify({
        requestId,
        commandName,
        discordUserId,
        focusedValue,
    });

    await redis.rPush(listKey, payload);

    // 폴링: Worker가 resKey에 결과를 SET하면 즉시 반환
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const raw = await redis.get(resKey);
        if (raw != null) {
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

    log.warn(`[autocomplete] 타임아웃 tenant=${tenantKey} cmd=${commandName} reqId=${requestId}`);
    // 타임아웃 시 resKey 클린업(Worker가 늦게 쓸 수 있으므로)
    redis.del(resKey).catch(() => {});
    return [];
}
