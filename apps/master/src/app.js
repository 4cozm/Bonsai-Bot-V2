// apps/master/app.js
import {
    createDiscordClient,
    deployGuildCommands,
    initializeMaster,
    routeInteraction,
} from "@bonsai/master";
import { logger } from "@bonsai/shared";
import { GatewayIntentBits } from "discord.js";

function isDevMode() {
    return String(process.env.isDev || "").toLowerCase() === "true";
}

async function main() {
    const log = logger();

    // dev에서는 master 프로세스를 아예 올리지 않음 (불필요한 시크릿/디스코드 부팅 방지)
    if (isDevMode()) {
        log.info("[master] 개발환경에서는 master 프로세스가 자동 비활성화 됩니다");
        process.exit(0);
    }

    // 시크릿 로드
    await initializeMaster();
    log.info(
        `[master] after vault cwd=${process.cwd()} isDev=${process.env.isDev ?? "(undefined)"}`
    );

    const token = String(process.env.DISCORD_TOKEN || "").trim();
    if (!token) {
        log.error("[master] DISCORD_TOKEN 미설정 - 종료");
        process.exit(1);
    }

    const client = createDiscordClient({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });

    client.once("clientReady", async () => {
        const tag = client.user?.tag ?? "(unknown)";
        const gid = String(process.env.DISCORD_GUILD_ID || "").trim();

        log.info(`[master] 로그인 완료: ${tag}`);

        if (!gid) {
            log.info("[master] DISCORD_GUILD_ID 미설정 (로그만 생략)");
            return;
        }

        const g = client.guilds.cache.get(gid);
        if (g) log.info(`[master] 대상 길드 캐시 확인: ${g.name} (${g.id})`);
        else log.error(`[master] 대상 길드가 캐시에 없음: ${gid}`);
        await deployGuildCommands();
    });

    client.on("interactionCreate", (interaction) => routeInteraction(interaction));

    client.on("error", (err) => {
        log.warn("[master] Discord client error", err);
    });

    client.on("shardError", (err) => {
        log.warn("[master] Discord shard error", err);
    });

    let shuttingDown = false;

    const shutdown = async (signal, err) => {
        if (shuttingDown) return;
        shuttingDown = true;

        try {
            if (err) log.warn(`[master] 종료 트리거(${signal})`, err);
            else log.info(`[master] 종료 요청(${signal}) - 디스코드 연결 정리`);

            try {
                await client.destroy();
            } catch (e) {
                log.warn("[master] Discord destroy 중 오류", e);
            }
        } finally {
            process.exit(0);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("unhandledRejection", (err) => shutdown("unhandledRejection", err));
    process.on("uncaughtException", (err) => shutdown("uncaughtException", err));

    log.info("[master] Discord 로그인 시도");
    await client.login(token);
}

main().catch((err) => {
    logger().warn("[master] 부팅 실패", err);
    process.exit(1);
});
