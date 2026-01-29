// packages/master/src/discord/interactionRouter.js
import { logger } from "@bonsai/shared";
import { publishDevCommand } from "../usecases/publishDevCommand.js";
import { publishProdCommand } from "../usecases/publishProdCommand.js";
import { getRegistryByName } from "./commandRegistry.js";

const log = logger();

/**
 * Discord Interaction을 레지스트리 기반으로 라우팅한다.
 * @param {object} interaction - discord.js Interaction
 * @returns {Promise<void>}
 */
export async function routeInteraction(interaction) {
    if (!interaction.isChatInputCommand?.()) return;

    const byName = getRegistryByName();
    const item = byName.get(interaction.commandName);

    if (!item) {
        log.error(`[router] 알 수 없는 커맨드: ${interaction.commandName}`);
        await interaction.reply({ content: "알 수 없는 명령", ephemeral: true });
        return;
    }

    // 3초 제한 회피: 먼저 ACK
    await interaction.deferReply({ ephemeral: true });

    try {
        if (item.key === "dev") {
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

            await interaction.editReply(
                `dev 명령 발행 완료 (tenant=${res.tenantKey}, targetDev=${res.targetDev})`
            );
            return;
        }

        if (item.key === "ping") {
            const res = await publishProdCommand({
                discordUserId: interaction.user.id,
                guildId: interaction.guildId ?? "",
                channelId: interaction.channelId ?? "",
                cmd: "ping",
                args: "",
                interactionId: interaction.id,
                interactionToken: interaction.token,
            });

            await interaction.editReply(`prod 명령 발행 완료 (tenant=${res.tenantKey})`);
            return;
        }

        await interaction.editReply("아직 라우팅 미구현");
    } catch (err) {
        log.error("[router] 처리 실패", err);
        // deferReply를 했으니 editReply로 마무리
        await interaction.editReply("처리 실패");
    }
}
