import { initializeOrchestrator } from "@bonsai/orchestrator";
import { logger } from "@bonsai/shared";

async function main() {
    const log = logger();
    log.info("[global] 부팅 시작");
    await initializeOrchestrator();
}

process.on("unhandledRejection", (err) => {
    logger().warn("[global] unhandledRejection", err);
    process.exit(1);
});
process.on("uncaughtException", (err) => {
    logger().warn("[global] uncaughtException", err);
    process.exit(1);
});

main().catch((err) => {
    logger().warn("[global] 부팅 실패", err);
    process.exit(1);
});
