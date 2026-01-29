// packages/master/src/usecases/prod/publishProdCommand.js
import { buildCmdEnvelope, logger } from "@bonsai/shared";
import { resolveTenantKey } from "../config/tenantChannelMap.js";
// TODO: Redis Streams publisher 붙이면 여기서 가져오면 됨
// import { publishStreamJson } from "@bonsai/external";

const log = logger();

/**
 * 프로덕트 테넌트(worker)로 명령을 발행한다. (Redis Streams 예정)
 * - DEV_DISCORD_MAP/targetDev 같은 dev 정책은 절대 포함하지 않는다.
 *
 * @param {object} input
 * @param {string} input.discordUserId
 * @param {string} input.guildId
 * @param {string} input.channelId
 * @param {string} input.cmd
 * @param {string} [input.args]
 * @param {string} [input.interactionId]
 * @param {string} [input.interactionToken]
 * @returns {Promise<{tenantKey: string, envelopeId: string}>}
 */
export async function publishProdCommand(input) {
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

    log.info(`[prod] RedisStreams 발행(예정) tenant=${tenantKey} cmd=${cmd} args=${args}`);

    // TODO: Redis Streams publish 연결
    // await publishStreamJson({ stream: "bonsai:cmd", envelope });
    // 지금은 스텁: 실제 연결 전이라도 호출 흐름만 맞추려고 envelopeId 반환
    return { tenantKey, envelopeId: envelope.id };
}
