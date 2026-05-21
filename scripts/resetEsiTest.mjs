// scripts/resetEsiTest.mjs
//
// ESI 테스트 데이터 초기화 스크립트 (로컬 개발 전용).
// - DB: EveCharacter, EsiRegistration 삭제
// - Redis: pajama online/docking 초기화, ESI nonce 삭제
//
// 사용법:
//   node --env-file=.env scripts/resetEsiTest.mjs [tenantKey] [characterId]
//
// 예시:
//   node --env-file=.env scripts/resetEsiTest.mjs CAT 2124027122

import { createRedisClient, loadVaultSecrets } from "@bonsai/external";
import { getPrisma } from "@bonsai/shared/db";

const tenantKey  = process.argv[2] ?? "CAT";
const characterId = process.argv[3] ? BigInt(process.argv[3]) : null;

const isDev = String(process.env.isDev ?? "").toLowerCase() === "true";
const VAULT_URL = isDev
    ? "https://bonsai-bot-dev.vault.azure.net/"
    : "https://bonsai-bot.vault.azure.net/";

const log = {
    info: (...a) => console.log("[vault]", ...a),
    warn: (...a) => console.warn("[vault]", ...a),
    error: (...a) => console.error("[vault]", ...a),
};

console.log(`[reset] Key Vault 로드 중 (${VAULT_URL}) ...`);
await loadVaultSecrets({
    vaultUrl: VAULT_URL,
    sharedKeys: ["REDIS_URL", "TENANT_DB_URL_TEMPLATE", "DATABASE_URL"],
    tenantKeys: [],
    tenant: "__script__",
    log,
});

const redis  = await createRedisClient();
const prisma = getPrisma(tenantKey);

// ── DB 초기화 ─────────────────────────────────────────────────────────────

if (characterId) {
    const deleted = await prisma.eveCharacter.deleteMany({
        where: { characterId },
    });
    console.log(`[reset] EveCharacter 삭제 characterId=${characterId} count=${deleted.count}`);
}

// dev-test-user 로 생성된 EsiRegistration 전체 삭제
const deletedReg = await prisma.esiRegistration.deleteMany({
    where: { discordUserId: "dev-test-user" },
});
console.log(`[reset] EsiRegistration 삭제 discordUserId=dev-test-user count=${deletedReg.count}`);

// ── Redis 초기화 ──────────────────────────────────────────────────────────

const prefix = `bonsai:${tenantKey}:pajama`;

// online / docking 비우기 (target·structures는 유지)
await redis.set(`${prefix}:online`,  JSON.stringify([]));
await redis.set(`${prefix}:docking`, JSON.stringify([]));
console.log(`[reset] Redis ${prefix}:online / :docking 초기화 완료`);

// 남은 ESI nonce 키 삭제
const nonceKeys = await redis.keys("bonsai:esi:nonce:*");
if (nonceKeys.length > 0) {
    await redis.del(nonceKeys);
    console.log(`[reset] Redis ESI nonce ${nonceKeys.length}개 삭제`);
}

console.log("\n[reset] 초기화 완료. 이제 issueEsiLink.mjs 를 실행하세요.");
console.log(`  node --env-file=.env scripts/issueEsiLink.mjs ${tenantKey} dev-test-user\n`);

await redis.quit();
await prisma.$disconnect();
