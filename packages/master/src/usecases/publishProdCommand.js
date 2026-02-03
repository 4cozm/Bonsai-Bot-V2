// packages/master/src/usecases/publishProdCommand.js
import { buildCmdEnvelope, logger } from "@bonsai/shared";
import { publishCmdToRedisStream } from "../bus/publishCmdToRedisStream.js";
import { resolveTenantKey } from "../config/tenantChannelMap.js";

const log = logger();

/**
 * Prod 명령을 Redis Streams로 발행한다.
 * - channelId -> tenantKey 라우팅
 * - envelope.id를 반환해서 pending 매칭 키로 사용한다.
 *
 * @param {object} input
 * @param {string} input.discordUserId
 * @param {string} input.guildId
 * @param {string} input.channelId
 * @param {string} input.cmd
 * @param {string} [input.args]
 * @param {object} deps
 * @param {import("redis").RedisClientType} deps.redis
 * @returns {Promise<{tenantKey:string, envelopeId:string}>}
 */
export async function publishProdCommand(input, deps) {
    const redis = deps?.redis;
    if (!redis) throw new Error("redis 주입이 필요합니다.");

    const discordUserId = String(input.discordUserId ?? "");
    const guildId = String(input.guildId ?? "");
    const channelId = String(input.channelId ?? "");
    const cmd = String(input.cmd ?? "").trim();
    const args = input.args == null ? "" : String(input.args);

    if (!discordUserId || !guildId || !channelId) {
        log.error("[prod] 필수 메타 누락", { discordUserId, guildId, channelId });
        throw new Error("필수 메타 누락");
    }
    if (!cmd) throw new Error("cmd가 비어있음");

    const tenantKey = resolveTenantKey(channelId);
    if (!tenantKey) {
        log.error(`[prod] 허용되지 않은 채널 channelId=${channelId}`);
        throw new Error("허용되지 않은 채널");
    }

    const envelope = buildCmdEnvelope({
        tenantKey,
        cmd,
        args,
        meta: { discordUserId, guildId, channelId },
    });

    await publishCmdToRedisStream({ redis, envelope });

    log.info(`[prod] streams 발행 tenant=${tenantKey} cmd=${cmd} envelopeId=${envelope.id}`);
    return { tenantKey, envelopeId: envelope.id };
}
