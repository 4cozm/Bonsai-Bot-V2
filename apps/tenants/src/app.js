// apps/tenants/src/app.js
import { logger } from "@bonsai/shared";
import { initializeWorker } from "@bonsai/worker";

function mustGet(name) {
    const v = String(process.env[name] || "").trim();
    if (!v) throw new Error(`환경변수 누락: ${name}`);
    return v;
}

async function main() {
    const log = logger();

    const tenant = mustGet("TENANT");
    log.info(`[worker:${tenant}] 부팅 시작`);

    await initializeWorker({ log });

    log.info(`[worker:${tenant}] 스텁 실행 중`);
    // TODO: 여기서 실제 큐 consume / 워커 루프를 시작해야 함.
}

process.on("SIGINT", () => {
    logger().info("[worker] 종료(SIGINT)");
    process.exit(0);
});
process.on("SIGTERM", () => {
    logger().info("[worker] 종료(SIGTERM)");
    process.exit(0);
});

main().catch((err) => {
    logger().warn("[worker] 부팅 실패", err);
    process.exit(1);
});
