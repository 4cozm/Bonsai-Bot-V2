import { publishJson } from "@bonsai/external";
import { logger } from "@bonsai/shared";
import { resolveTargetDev } from "../config/devDiscordMap.js";
import { resolveTenantKey } from "../config/tenantChannelMap.js";

const log = logger();

/**
 * /dev cmd(+args)를 SNS로 발행한다. (원시값 기반)
 * - 권한 체크: discordUserId -> DEV_DISCORD_MAP 매핑이 있어야 통과
 * - 채널 체크: channelId -> DISCORD_TENANT_MAP 매핑이 있어야 통과 (테넌트 라우팅)
 * - SNS->SQS 필터를 위해 message body에 targetDev: [string] 포함
 *
 * @param {object} input
 * @param {string} input.discordUserId
 * @param {string} input.guildId
 * @param {string} input.channelId
 * @param {string} input.cmd
 * @param {string} [input.args]
 * @returns {Promise<{messageId: string, targetDev: string, tenantKey: string}>}
 */
export async function publishDevCommand(input) {
    const discordUserId = String(input.discordUserId ?? "");
    const guildId = String(input.guildId ?? "");
    const channelId = String(input.channelId ?? "");
    const cmd = String(input.cmd ?? "").trim();
    const args = input.args == null ? "" : String(input.args);

    if (!discordUserId || !channelId) {
        log.error("[dev] 필수 메타 누락", { discordUserId, channelId });
        throw new Error("필수 메타 누락");
    }
    if (!guildId) throw new Error("guildId가 없음"); //안전빵 2차 검증

    if (!cmd) {
        log.error("[dev] cmd가 비어있음");
        throw new Error("cmd가 비어있음");
    }

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

    const envelope = {
        kind: "dev",
        tenantKey,
        targetDev: [targetDev],
        cmd,
        args,
        meta: {
            discordUserId,
            guildId,
            channelId,
            issuedAt: Math.floor(Date.now() / 1000),
        },
    };

    log.info(`SNS 발행 tenant=${tenantKey} cmd=${cmd} args=${args} targetDev=${targetDev}`);

    const { messageId } = await publishJson(envelope);
    return { messageId, targetDev, tenantKey };
}
