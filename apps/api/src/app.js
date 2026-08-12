// apps/api/src/app.js
import { startApiServer } from "@bonsai/api";
import { logger } from "@bonsai/shared";

function main() {
    const log = logger();
    const port = Number(process.env.API_PORT ?? 4000);

    log.info("[api] 부팅 시작");
    const server = startApiServer({ port, log });

    const shutdown = (signal) => {
        log.info(`[api] 종료 요청(${signal})`);
        server.close(() => process.exit(0));
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
