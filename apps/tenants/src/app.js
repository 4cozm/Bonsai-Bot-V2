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
// 이 프로세스가 죽으면(pm2 autorestart:false라 재고 동기화 cron을 포함해 이
// 테넌트의 모든 백그라운드 작업이 재시작 전까지 조용히 멈춘다) 최소한 왜
// 죽었는지는 구조화 로그로 남긴다 — 핸들러가 없으면 Node 기본 stderr 출력만
// 남아서 놓치기 쉽다. apps/global/src/app.js와 같은 패턴.
process.on("unhandledRejection", (err) => {
    logger().warn("[worker] unhandledRejection", err);
    process.exit(1);
});
process.on("uncaughtException", (err) => {
    logger().warn("[worker] uncaughtException", err);
    process.exit(1);
});

main().catch((err) => {
    logger().warn("[worker] 부팅 실패", err);
    process.exit(1);
});
