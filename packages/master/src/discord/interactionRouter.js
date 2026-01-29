import { logger } from "@bonsai/shared";
import { publishDevCommand } from "../usecases/publishDevCommand.js";
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
        await interaction.reply?.({ content: "알 수 없는 명령", ephemeral: true });
        return;
    }

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
            });

            await interaction.reply?.({
                content: `dev 명령 발행 완료 (tenant=${res.tenantKey}, targetDev=${res.targetDev})`,
                ephemeral: true,
            });
            return;
        }

        if (item.key === "ping") {
            await interaction.reply?.({ content: "pong", ephemeral: true });
            return;
        }

        // 앞으로 prod 명령은 여기서 RedisStreams로 publishProdCommand(...) 같은 식으로 확장
        await interaction.reply?.({ content: "아직 라우팅 미구현", ephemeral: true });
    } catch (err) {
        log.error("[router] 처리 실패", err);
        await interaction.reply?.({ content: "처리 실패", ephemeral: true });
    }
}
