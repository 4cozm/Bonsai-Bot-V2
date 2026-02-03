// packages/master/src/discord/interactionRouter.js
import { logger } from "@bonsai/shared";
import { publishDevCommand } from "../usecases/publishDevCommand.js";
import { publishProdCommand } from "../usecases/publishProdCommand.js";
import { getRegistryByName } from "./commandRegistry.js";

const log = logger();

/**
 * Discord Interaction을 레지스트리 기반으로 라우팅한다.
 *
 * @param {object} interaction - discord.js Interaction
 * @param {object} [ctx]
 * @param {Map<string, any>} [ctx.pendingMap] - envelopeId -> {interaction}
 * @param {import("redis").RedisClientType} [ctx.redis] - prod cmd publish용
 * @returns {Promise<void>}
 */
export async function routeInteraction(interaction, ctx = {}) {
    if (!interaction.isChatInputCommand?.()) return;

    const { pendingMap, redis } = ctx;

    const byName = getRegistryByName();
    const item = byName.get(interaction.commandName);

    if (!item) {
        log.error(`[router] 알 수 없는 커맨드: ${interaction.commandName}`);
        await interaction.reply({ content: "알 수 없는 명령", flags: 64 });
        return;
    }

    await interaction.deferReply({ flags: 64 });

    try {
        // -----------------------
        // DEV: 발행 + 결과 대기형
        // -----------------------
        if (item.key === "dev") {
            if (!pendingMap) throw new Error("pendingMap 주입이 없습니다.");

            const cmd = interaction.options.getString("cmd", true);
            const args = interaction.options.getString("args", false) ?? "";

            const res = await publishDevCommand({
                discordUserId: interaction.user.id,
                guildId: interaction.guildId ?? "",
                channelId: interaction.channelId ?? "",
                cmd,
                args,
                interactionId: interaction.id,
                interactionToken: interaction.token,
            });

            pendingMap.set(res.envelopeId, { interaction });

            // 여기서는 접수만. 최종 응답은 prodBridge가 editReply로 덮는다.
            await interaction.editReply(
                `dev 요청 접수됨 (tenant=${res.tenantKey}, targetDev=${res.targetDev})\n처리 중...`
            );
            return;
        }

        // -----------------------
        // PING: prod publish + 결과 대기형
        // -----------------------
        if (item.key === "ping") {
            if (!redis) throw new Error("redis 주입이 없습니다.");
            if (!pendingMap) throw new Error("pendingMap 주입이 없습니다.");

            const res = await publishProdCommand(
                {
                    discordUserId: interaction.user.id,
                    guildId: interaction.guildId ?? "",
                    channelId: interaction.channelId ?? "",
                    cmd: "ping",
                    args: "",
                },
                { redis }
            );

            pendingMap.set(res.envelopeId, { interaction });
            await interaction.editReply(`요청 접수됨 (tenant=${res.tenantKey})\n처리 중...`);
            return;
        }

        await interaction.editReply("아직 라우팅 미구현");
    } catch (err) {
        log.error("[router] 처리 실패", err);
        await interaction.editReply("처리 실패");
    }
}
