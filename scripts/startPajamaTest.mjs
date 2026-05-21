// scripts/startPajamaTest.mjs
//
// 잠옷 모니터 테스트 초기화 스크립트 (로컬 개발 전용).
//   1) Redis pajama 상태 초기화 (online / docking / target / hot)
//   2) runHotUserClassification 즉시 실행
//      → DB의 EveCharacter 기준으로 hot 리스트 설정
//      → PAJAMA_TEST_STRUCTURE_IDS 기준으로 structures 설정
//   3) 결과 출력 후 종료 → pm2 restart CAT 으로 워커 재시작
//
// 사용법:
//   node --env-file=.env scripts/startPajamaTest.mjs [tenantKey]
//
// 전제조건:
//   - .env 에 PAJAMA_TEST_STRUCTURE_IDS 설정
//   - DB에 EveCharacter 행 존재 (scripts/issueEsiLink.mjs + OAuth 완료)
//   - Azure CLI / DefaultAzureCredential 로그인 상태

import { createRedisClient, loadVaultSecrets } from "@bonsai/external";
import { getPrisma } from "@bonsai/shared/db";
import { runHotUserClassification } from "../packages/worker/src/pajama/hotUserScheduler.js";

const tenantKey = process.argv[2] ?? "CAT";

const isDev = String(process.env.isDev ?? "").toLowerCase() === "true";
const VAULT_URL = isDev
    ? "https://bonsai-bot-dev.vault.azure.net/"
    : "https://bonsai-bot.vault.azure.net/";

const log = {
    info: (...a) => console.log("[vault]", ...a),
    warn: (...a) => console.warn("[vault]", ...a),
    error: (...a) => console.error("[vault]", ...a),
};

console.log(`[test] Key Vault 로드 중 (${VAULT_URL}) ...`);
await loadVaultSecrets({
    vaultUrl: VAULT_URL,
    sharedKeys: ["REDIS_URL", "TENANT_DB_URL_TEMPLATE", "DATABASE_URL"],
    tenantKeys: [],
    tenant: "__script__",
    log,
});

const redis  = await createRedisClient();
const prisma = getPrisma(tenantKey);

// ── Redis pajama 상태 초기화 ────────────────────────────────────────────────
const prefix = `bonsai:${tenantKey}:pajama`;
await Promise.all([
    redis.set(`${prefix}:online`,  JSON.stringify([])),
    redis.set(`${prefix}:docking`, JSON.stringify([])),
    redis.set(`${prefix}:target`,  JSON.stringify([])),
    redis.set(`${prefix}:hot`,     JSON.stringify([])),
]);
console.log(`[test] Redis ${prefix} 초기화 완료 (online/docking/target/hot → [])`);

// ── hot 분류 + structures 설정 ──────────────────────────────────────────────
console.log(`[test] runHotUserClassification 실행 중 ...`);
await runHotUserClassification({ prisma, redis, tenantKey });

// ── 결과 확인 ───────────────────────────────────────────────────────────────
const [hot, structures] = await Promise.all([
    redis.get(`${prefix}:hot`),
    redis.get(`${prefix}:structures`),
]);
console.log(`\n[test] ── 설정 결과 ──────────────────────────`);
console.log(`  hot        : ${hot}`);
console.log(`  structures : ${structures}`);
console.log(`──────────────────────────────────────────────`);
console.log(`\n[test] 완료. 이제 워커를 재시작하세요:`);
console.log(`  pm2 restart ${tenantKey}\n`);

await redis.quit();
await prisma.$disconnect();
