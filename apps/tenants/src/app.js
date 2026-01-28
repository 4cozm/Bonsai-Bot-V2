import "dotenv/config";
import { importVaultSecrets } from "../../../packages/adapters/src/keyvault/importVaultSecrets.js";
import { logger } from "../../../packages/core/src/utils/logger.js";

function mustGet(name) {
    const v = (process.env[name] || "").trim();
    if (!v) throw new Error(`환경변수 누락: ${name}`);
    return v;
}

async function main() {
    const log = logger();

    try {
        const tenant = mustGet("TENANT");
        log.info(`[worker:${tenant}] 부팅 시작`);

        await importVaultSecrets();

        log.info(`[worker:${tenant}] 스텁 실행 중`);

        setInterval(() => {}, 60_000);
    } catch (err) {
        log.warn("[worker] 부팅 실패", err);
        process.exit(1);
    }
}

process.on("SIGINT", () => {
    logger().info("[worker] 종료(SIGINT)");
    process.exit(0);
});
process.on("SIGTERM", () => {
    logger().info("[worker] 종료(SIGTERM)");
    process.exit(0);
});

main();
