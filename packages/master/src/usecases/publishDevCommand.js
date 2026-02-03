// packages/master/src/usecases/publishDevCommand.js
import { publishJson } from "@bonsai/external";
import { buildCmdEnvelope, logger } from "@bonsai/shared";
import { resolveTargetDev } from "../config/devDiscordMap.js";
import { resolveTenantKey } from "../config/tenantChannelMap.js";

const log = logger();

/**
 * /dev 명령으로 받은 inner cmd(+args)를 DEV worker로 SNS 발행한다.
 * - DEV_DISCORD_MAP 권한/타겟 해석 포함
 * - DISCORD_TENANT_MAP 채널 허용 + 테넌트 라우팅 포함
 *
 * @param {object} input
 * @param {string} input.discordUserId
 * @param {string} input.guildId
 * @param {string} input.channelId
 * @param {string} input.cmd
 * @param {string} [input.args]
 * @param {string} [input.interactionId]
 * @param {string} [input.interactionToken]
 * @returns {Promise<{messageId: string, targetDev: string, tenantKey: string, envelopeId: string}>}
 */
export async function publishDevCommand(input) {
    const discordUserId = String(input.discordUserId ?? "");
    const guildId = String(input.guildId ?? "");
    const channelId = String(input.channelId ?? "");
    const cmd = String(input.cmd ?? "").trim();
    const args = input.args == null ? "" : String(input.args);

    if (!discordUserId || !guildId || !channelId) {
        log.error("[dev] 필수 메타 누락", { discordUserId, guildId, channelId });
        throw new Error("필수 메타 누락");
    }
    if (!cmd) throw new Error("cmd가 비어있음");

    const targetDev = resolveTargetDev(discordUserId);
    if (!targetDev) {
        log.error(`[dev] 권한 없음 discordUserId=${discordUserId}`);
        throw new Error("dev 권한 없음");
    }

    const tenantKey = resolveTenantKey(channelId);
    if (!tenantKey) {
        log.error(`[dev] 허용되지 않은 채널 channelId=${channelId}`);
        throw new Error("허용되지 않은 채널");
    }

    const envelope = buildCmdEnvelope({
        tenantKey,
        cmd,
        args,
        meta: { discordUserId, guildId, channelId },
    });

    envelope.targetDev = [targetDev];

    log.info(`[dev] SNS 발행 tenant=${tenantKey} cmd=${cmd} args=${args} targetDev=${targetDev}`);

    const { messageId } = await publishJson(envelope, {
        targetDev,
        type: "cmd",
    });
    return { messageId, targetDev, tenantKey, envelopeId: envelope.id };
}
