// apps/master/app.js
import { createRedisClient } from "@bonsai/external";
import {
    createDiscordClient,
    deployGuildCommands,
    initializeMaster,
    routeInteraction,
    startDevBridge,
    startProdBridge,
} from "@bonsai/master";
import { logger } from "@bonsai/shared";
import { GatewayIntentBits } from "discord.js";

function isDevMode() {
    return String(process.env.isDev || "").toLowerCase() === "true";
}

async function main() {
    const log = logger();

    await initializeMaster();
    const redis = await createRedisClient();

    const isDev = isDevMode();
    log.info(
        `[master] after vault cwd=${process.cwd()} isDev=${process.env.isDev ?? "(undefined)"}`
    );

    const ac = new AbortController();

    // prod에서만 존재(초기값 null)
    let client = null;

    let shuttingDown = false;
    const shutdown = async (signal, err) => {
        if (shuttingDown) return;
        shuttingDown = true;

        try {
            ac.abort();

            if (err) log.warn(`[master] 종료 트리거(${signal})`, err);
            else log.info(`[master] 종료 요청(${signal}) - 리소스 정리`);

            if (client) {
                try {
                    await client.destroy();
                } catch (e) {
                    log.warn("[master] Discord destroy 중 오류", e);
                }
            }

            try {
                await redis.quit();
            } catch (e) {
                log.warn("[master] Redis quit 중 오류", e);
            }
        } finally {
            process.exit(0);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("unhandledRejection", (err) => shutdown("unhandledRejection", err));
    process.on("uncaughtException", (err) => shutdown("uncaughtException", err));

    // -----------------------
    // DEV MASTER (브릿지 전용)
    // -----------------------
    if (isDev) {
        log.info("[master] dev 모드: Dev Bridge 시작 (Discord 비활성)");

        try {
            await startDevBridge({ redis, signal: ac.signal });
        } catch (err) {
            await shutdown("devBridgeError", err);
        }
        return;
    }

    // -----------------------
    // PROD MASTER (Discord + result consumer)
    // -----------------------
    const token = String(process.env.DISCORD_TOKEN || "").trim();
    if (!token) {
        log.error("[master] DISCORD_TOKEN 미설정 - 종료");
        process.exit(1);
    }

    const pendingMap = new Map();

    startProdBridge({ redis, pendingMap, signal: ac.signal }).catch((err) => {
        shutdown("prodResultConsumerError", err);
    });

    client = createDiscordClient({
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

    client.on("interactionCreate", (interaction) =>
        routeInteraction(interaction, { pendingMap, redis })
    );

    client.on("error", (err) => log.warn("[master] Discord client error", err));
    client.on("shardError", (err) => log.warn("[master] Discord shard error", err));

    log.info("[master] Discord 로그인 시도");
    await client.login(token);
}

main().catch((err) => {
    logger().warn("[master] 부팅 실패", err);
    process.exit(1);
});
