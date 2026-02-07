// packages/master/src/usecases/publishDevCommand.js
import { publishJson } from "@bonsai/external";
import { buildCmdEnvelope, logger } from "@bonsai/shared";
import { resolveTargetDev } from "../config/devDiscordMap.js";
import { resolveTenantKey } from "../config/tenantChannelMap.js";

const log = logger();

/**
 * /dev 명령을 DEV worker로 발행한다.
 * - envelope.cmd는 항상 "dev"
 * - envelope.args에 {"cmd": innerCmd, "args": innerArgs} JSON 문자열을 넣는다
 *
 * @param {object} input
 * @param {string} input.discordUserId
 * @param {string} input.guildId
 * @param {string} input.channelId
 * @param {string} input.cmd       // inner cmd
 * @param {string} [input.args]    // inner args
 * @param {boolean} [input.ephemeral]  // true=비공개(기본), false=공개
 * @returns {Promise<{messageId: string, targetDev: string, tenantKey: string, envelopeId: string}>}
 */
export async function publishDevCommand(input) {
    const discordUserId = String(input.discordUserId ?? "");
    const guildId = String(input.guildId ?? "");
    const channelId = String(input.channelId ?? "");
    const innerCmd = String(input.cmd ?? "").trim();
    const innerArgs = input.args == null ? "" : String(input.args);
    const ephemeral = input.ephemeral !== false;

    if (!discordUserId || !guildId || !channelId) throw new Error("필수 메타 누락");
    if (!innerCmd) throw new Error("dev inner cmd가 비어있음");

    const targetDev = resolveTargetDev(discordUserId);
    if (!targetDev) throw new Error("dev 권한 없음");

    const tenantKey = resolveTenantKey(channelId);
    if (!tenantKey) throw new Error("허용되지 않은 채널");

    const envelope = buildCmdEnvelope({
        tenantKey,
        cmd: "dev",
        args: JSON.stringify({ cmd: innerCmd, args: innerArgs, ephemeral }),
        meta: { discordUserId, guildId, channelId },
    });

    envelope.targetDev = [targetDev];

    log.info(`[dev] SNS 발행 tenant=${tenantKey} innerCmd=${innerCmd} targetDev=${targetDev}`);

    const { messageId } = await publishJson(envelope, { targetDev, type: "cmd" });
    return { messageId, targetDev, tenantKey, envelopeId: envelope.id };
}
