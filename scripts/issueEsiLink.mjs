// scripts/issueEsiLink.mjs
//
// ESI OAuth 링크 수동 발급 스크립트 (로컬 개발 전용).
// Key Vault에서 REDIS_URL·TENANT_DB_URL_TEMPLATE 을 로드한 뒤,
// esiSignup 커맨드와 동일한 흐름으로 EsiRegistration 행을 생성하고
// 인증 URL을 터미널에 출력한다.
//
// 사용법:
//   node --env-file=.env scripts/issueEsiLink.mjs [tenantKey] [discordUserId]
//
// 예시:
//   node --env-file=.env scripts/issueEsiLink.mjs CAT dev-test-user
//
// 전제조건:
//   - .env 에 isDev=true 및 ESI 자격증명이 설정되어 있어야 함
//   - Azure CLI / DefaultAzureCredential 로그인 상태이어야 함
//   - 오케스트레이터(global 프로세스, port 3000)가 실행 중이어야 콜백 처리 가능

import { createRedisClient, loadVaultSecrets } from "@bonsai/external";
import { getPrisma } from "@bonsai/shared/db";
import { issueNonce, signState } from "@bonsai/shared";
import { randomUUID } from "node:crypto";

const tenantKey = process.argv[2] ?? "CAT";
const discordUserId = process.argv[3] ?? "dev-test-user";
const discordNick = "dev-test";

const isDev = String(process.env.isDev ?? "").toLowerCase() === "true";
const VAULT_URL = isDev
    ? "https://bonsai-bot-dev.vault.azure.net/"
    : "https://bonsai-bot.vault.azure.net/";

const log = {
    info: (...a) => console.log("[vault]", ...a),
    warn: (...a) => console.warn("[vault]", ...a),
    error: (...a) => console.error("[vault]", ...a),
};

console.log(`[script] Key Vault 로드 중 (${VAULT_URL}) ...`);
await loadVaultSecrets({
    vaultUrl: VAULT_URL,
    sharedKeys: ["REDIS_URL", "TENANT_DB_URL_TEMPLATE", "DATABASE_URL"],
    tenantKeys: [],
    tenant: "__script__",
    log,
});

const secret = String(process.env.ESI_STATE_SECRET ?? "").trim();
const clientId = String(process.env.EVE_ESI_CLIENT_ID ?? "").trim();
const redirectUri = String(process.env.EVE_ESI_REDIRECT_URI ?? "").trim();

if (!secret || !clientId || !redirectUri) {
    console.error("[script] ESI 설정 누락 — ESI_STATE_SECRET, EVE_ESI_CLIENT_ID, EVE_ESI_REDIRECT_URI 확인");
    process.exit(1);
}

// 잠옷 모니터에 필요한 스코프만 요청
const scope = [
    "esi-clones.read_clones.v1",
    "esi-clones.read_implants.v1",
    "esi-location.read_location.v1",
    "esi-location.read_online.v1",
    "esi-ui.open_window.v1",
].join(" ");

const redis = await createRedisClient();
const prisma = getPrisma(tenantKey);

const STATE_TTL_SEC = 600;
const NONCE_TTL_SEC = 660;

const stateNonce = randomUUID();
const nonceKey = `bonsai:esi:nonce:${stateNonce}`;
await issueNonce(redis, nonceKey, NONCE_TTL_SEC);

const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SEC;
const statePayload = {
    v: 1,
    discordId: discordUserId,
    discordNick,
    stateNonce,
    exp,
    tenantKey,
};
const stateStr = signState(statePayload, secret);

try {
    await prisma.discordUser.upsert({
        where: { id: discordUserId },
        create: { id: discordUserId },
        update: {},
    });
} catch (e) {
    console.warn("[script] discordUser upsert 실패 (무시):", e.message);
}

// channelId를 설정해야 콜백 서버가 esi-complete 를 발행하고
// eveCharacter 행이 생성된다. 더미값이라도 반드시 비워두면 안 됨.
await prisma.esiRegistration.create({
    data: {
        discordUserId,
        stateNonce,
        stateExpAt: new Date(exp * 1000),
        discordNick,
        status: "PENDING",
        guildId: "dev-guild",
        channelId: "dev-channel",
    },
});

const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: stateStr,
});
const authorizeUrl = `https://login.eveonline.com/v2/oauth/authorize/?${params.toString()}`;

console.log("\n========== EVE ESI 가입 링크 (10분 유효) ==========");
console.log(authorizeUrl);
console.log("====================================================");
console.log(`\n tenant: ${tenantKey} / discordUserId: ${discordUserId}`);
console.log(" 위 URL → EVE 로그인 → http://localhost:3000/auth/eve/callback 으로 자동 리다이렉트");
console.log(" 오케스트레이터(global)가 실행 중이어야 콜백이 처리됩니다.\n");

await redis.quit();
await prisma.$disconnect();
