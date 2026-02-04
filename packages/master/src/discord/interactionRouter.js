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
    const { pendingMap, redis } = ctx;

    // 버튼(승인 등): custom_id로 cmd/args 유도. 해석/실행은 Worker가 SoT.
    if (interaction.isButton?.()) {
        await handleButtonInteraction(interaction, ctx);
        return;
    }
    if (!interaction.isChatInputCommand?.()) return;

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
 * 버튼 interaction: custom_id가 "esi-approve:{registrationId}" 형태면 Worker에 esi-approve 전달.
 * Master는 라우팅만. 명령 해석/실행 금지.
 */
async function handleButtonInteraction(interaction, ctx) {
    const { pendingMap, redis } = ctx;
    if (!pendingMap || !redis) {
        try {
            await interaction.reply({ content: "처리할 수 없습니다.", ephemeral: true });
        } catch {
            // already replied
        }
        return;
    }

    const customId = String(interaction.customId ?? "").trim();
    const prefix = "esi-approve:";
    if (!customId.startsWith(prefix)) {
        try {
            await interaction.reply({ content: "알 수 없는 버튼입니다.", ephemeral: true });
        } catch {
            // ignore
        }
        return;
    }

    const registrationId = customId.slice(prefix.length).trim();
    if (!registrationId) {
        try {
            await interaction.reply({ content: "등록 ID가 없습니다.", ephemeral: true });
        } catch {
            // ignore
        }
        return;
    }

    await interaction.deferReply({ flags: 0 });

    try {
        const args = JSON.stringify({ registrationId });
        const res = await publishProdCommand(
            {
                discordUserId: interaction.user.id,
                guildId: interaction.guildId ?? "",
                channelId: interaction.channelId ?? "",
                cmd: "esi-approve",
                args,
            },
            { redis }
        );
        pendingMap.set(res.envelopeId, { interaction });
        await interaction.editReply(`승인 처리 중...`);
    } catch (err) {
        log.error("[router] 버튼 처리 실패", err);
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
