import "dotenv/config";
import { createDiscordClient } from "../../../packages/adapters/src/discord/createDiscordClient.js";
import { importVaultSecrets } from "../../../packages/adapters/src/keyvault/importVaultSecrets.js";
import { logger } from "../../../packages/core/src/utils/logger.js";

function isDevMode() {
    return (process.env.isDev || "").toLowerCase() === "true";
}

async function main() {
    const log = logger();
    log.info(`[master] cwd=${process.cwd()} isDev=${process.env.isDev ?? "(undefined)"}`);
    await importVaultSecrets();
    log.info(
        `[master] after vault cwd=${process.cwd()} isDev=${process.env.isDev ?? "(undefined)"}`
    );

    if (isDevMode()) {
        log.info("[master] 개발환경에서는 master 프로세스가 자동 비활성화 됩니다");
        process.exit(0);
    }

    const client = createDiscordClient();

    client.once("ready", async () => {
        const tag = client.user?.tag ?? "(unknown)";
        const gid = (process.env.DISCORD_GUILD_ID || "").trim();

        log.info(`[master] 로그인 완료: ${tag}`);

        if (gid) {
            const g = client.guilds.cache.get(gid);
            if (g) log.info(`[master] 대상 길드 캐시 확인: ${g.name} (${g.id})`);
            else log.error(`[master] 대상 길드가 캐시에 없음: ${gid}`);
        } else {
            log.info("[master] DISCORD_GUILD_ID 미설정 (로그만 생략)");
        }
    });

    client.on("error", (err) => {
        log.warn("[master] Discord client error", err);
    });

    client.on("shardError", (err) => {
        log.warn("[master] Discord shard error", err);
    });

    const shutdown = async (signal) => {
        try {
            log.info(`[master] 종료 요청(${signal}) - 디스코드 연결 정리`);
            await client.destroy();
        } catch (e) {
            log.warn("[master] 종료 정리 중 오류", e);
        } finally {
            process.exit(0);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    log.info("[master] Discord 로그인 시도");
    await client.login(process.env.DISCORD_TOKEN);

    setInterval(() => {}, 60_000);
}

main().catch((err) => {
    logger().warn("[master] 부팅 실패", err);
    process.exit(1);
});
