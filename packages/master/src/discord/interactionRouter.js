// packages/master/src/discord/interactionRouter.js
import { logger, pickDeferPhrase } from "@bonsai/shared";
import { handleAutocomplete } from "../usecases/handleAutocomplete.js";
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
    const { pendingMap, redis } = ctx;

    // Autocomplete: fast path (Redis List → Worker → 폴링 응답)
    if (interaction.isAutocomplete?.()) {
        // #region agent log
        const _routerAcStart = Date.now();
        log.warn(
            `[DEBUG:AC:R] autocomplete 수신 cmd=${interaction.commandName} t=${_routerAcStart}`
        );
        // #endregion
        try {
            const choices = await handleAutocomplete(interaction, { redis });
            // #region agent log
            log.warn(
                `[DEBUG:AC:R] handleAutocomplete 반환 choices=${choices.length} elapsed=${Date.now() - _routerAcStart}ms H3:respond직전`
            );
            // #endregion
            await interaction.respond(choices);
            // #region agent log
            log.warn(`[DEBUG:AC:R] respond 성공 totalElapsed=${Date.now() - _routerAcStart}ms`);
            // #endregion
        } catch (err) {
            // #region agent log
            log.warn(
                `[DEBUG:AC:R] respond 실패 elapsed=${Date.now() - _routerAcStart}ms err=${err?.message}`
            );
            // #endregion
            log.warn("[router] autocomplete 실패", err);
            try {
                await interaction.respond([]);
            } catch {
                // 이미 응답했거나 만료된 interaction — 무시
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand?.()) return;

    const discordReceivedAtMs = Date.now();
    await interaction.deferReply({ flags: 64 });

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
            const ephemeral = interaction.options.getBoolean("ephemeral") ?? true;

            const res = await publishDevCommand({
                discordUserId: interaction.user.id,
                guildId: interaction.guildId ?? "",
                channelId: interaction.channelId ?? "",
                cmd: innerCmd,
                args,
                ephemeral,
                interactionId: interaction.id,
                interactionToken: interaction.token,
                discordReceivedAtMs,
            });

            pendingMap.set(res.envelopeId, { interaction });
            await interaction.editReply(pickDeferPhrase());
            return;
        }

        // 나머지는 전부 prod로 전달(명령 유효성/해석은 worker가 함)
        if (!redis) throw new Error("redis 주입이 없습니다.");
        if (!pendingMap) throw new Error("pendingMap 주입이 없습니다.");

        const args = serializeOptions(interaction.options);
        const discordNick =
            interaction.options?.getString?.("nick") ??
            interaction.member?.displayName ??
            interaction.user?.username ??
            "";

        const res = await publishProdCommand(
            {
                discordUserId: interaction.user.id,
                guildId: interaction.guildId ?? "",
                channelId: interaction.channelId ?? "",
                cmd: cmdName,
                args,
                ...(discordNick && { discordNick }),
                discordReceivedAtMs,
            },
            { redis }
        );

        pendingMap.set(res.envelopeId, { interaction });
        await interaction.editReply(pickDeferPhrase());
    } catch (err) {
        log.error("[router] 처리 실패", err);
        const message =
            String(err?.message ?? "").trim() === "허용되지 않은 채널"
                ? "허용되지 않은 채널"
                : "처리 실패";
        await interaction.editReply(message);
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
