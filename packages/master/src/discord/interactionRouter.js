// packages/master/src/discord/interactionRouter.js
import { logger } from "@bonsai/shared";
import { publishDevCommand } from "../usecases/publishDevCommand.js";
import { publishProdCommand } from "../usecases/publishProdCommand.js";

const log = logger();

/**
 * @param {object} interaction
 * @param {object} [ctx]
 * @param {Map<string, any>} [ctx.pendingMap]
 * @param {import("redis").RedisClientType} [ctx.redis]
 */
export async function routeInteraction(interaction, ctx = {}) {
    if (!interaction.isChatInputCommand?.()) return;

    const { pendingMap, redis } = ctx;

    await interaction.deferReply({ flags: 0 });

    try {
        const cmdName = String(interaction.commandName ?? "").trim();
        if (!cmdName) {
            await interaction.editReply("명령 이름이 비어있습니다.");
            return;
        }

        // dev는 “브릿지 라우팅”이라 master에서만 특수 처리
        if (cmdName === "dev") {
            if (!pendingMap) throw new Error("pendingMap 주입이 없습니다.");

            const innerCmd = interaction.options.getString("cmd", true);
            const args = interaction.options.getString("args", false) ?? "";

            const res = await publishDevCommand({
                discordUserId: interaction.user.id,
                guildId: interaction.guildId ?? "",
                channelId: interaction.channelId ?? "",
                cmd: innerCmd,
                args,
                interactionId: interaction.id,
                interactionToken: interaction.token,
            });

            pendingMap.set(res.envelopeId, { interaction });
            await interaction.editReply(
                `dev 요청 접수됨 (tenant=${res.tenantKey}, targetDev=${res.targetDev})\n처리 중...`
            );
            return;
        }

        // 나머지는 전부 prod로 전달(명령 유효성/해석은 worker가 함)
        if (!redis) throw new Error("redis 주입이 없습니다.");
        if (!pendingMap) throw new Error("pendingMap 주입이 없습니다.");

        const args = serializeOptions(interaction.options);

        const res = await publishProdCommand(
            {
                discordUserId: interaction.user.id,
                guildId: interaction.guildId ?? "",
                channelId: interaction.channelId ?? "",
                cmd: cmdName,
                args,
            },
            { redis }
        );

        pendingMap.set(res.envelopeId, { interaction });
        await interaction.editReply(`요청 접수됨 (tenant=${res.tenantKey})\n처리 중...`);
    } catch (err) {
        log.error("[router] 처리 실패", err);
        await interaction.editReply("처리 실패");
    }
}

/**
 * Discord option들을 워커로 넘길 args 문자열로 직렬화한다.
 * - 지금은 단순 JSON으로 통일(워커가 해석)
 * - 필요하면 나중에 안정적인 스키마로 바꾸면 됨
 * @param {any} options
 * @returns {string}
 */
function serializeOptions(options) {
    try {
        // discord.js 구조에 의존하지 않게 “값만” 뽑아낸다(최소한)
        // NOTE: 필요한 타입만 추가해서 확장하면 됨
        const out = {};
        for (const opt of options?.data ?? []) {
            out[String(opt.name)] = opt.value ?? null;
        }
        return JSON.stringify(out);
    } catch {
        return "";
    }
}
