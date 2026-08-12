// apps/api/src/app.js
import { initializeApi, startApiServer } from "@bonsai/api";
import { createRedisClient } from "@bonsai/external";
import { logger } from "@bonsai/shared";

async function main() {
    const log = logger();

    log.info("[api] 부팅 시작");
    await initializeApi({ log });

    const port = Number(process.env.API_PORT ?? 4000);
    const redis = await createRedisClient();

    const server = startApiServer({ port, redis, log });

    const shutdown = async (signal) => {
        log.info(`[api] 종료 요청(${signal})`);
        server.close(async () => {
            try {
                await redis.quit();
            } catch {
                // 무시
            }
            process.exit(0);
        });
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
    logger().warn("[api] 부팅 실패", err);
    process.exit(1);
});
