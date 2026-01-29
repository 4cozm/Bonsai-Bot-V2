// packages/worker/src/initialize/index.js
import { loadVaultSecrets } from "@bonsai/external";
import { keySetsFor, logger } from "@bonsai/shared";
import dotenv from "dotenv";

const VAULT_URL_DEV = "https://bonsai-bot-dev.vault.azure.net/";
const VAULT_URL_PROD = "https://bonsai-bot.vault.azure.net/";

let dotenvLoaded = false;
function loadDotenvOnce() {
    if (dotenvLoaded) return;

    if (process.env.isDev != null && String(process.env.isDev).trim() !== "") {
        dotenvLoaded = true;
        return;
    }

    dotenvLoaded = true;
    dotenv.config();
}

function isDevMode() {
    return String(process.env.isDev || "").toLowerCase() === "true";
}

export async function initializeWorker({ log } = {}) {
    const l = log ?? logger();

    loadDotenvOnce();

    const isDev = isDevMode();
    const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;

    const { sharedKeys, tenantKeys } = keySetsFor({ role: "worker", isDev });

    await loadVaultSecrets({
        vaultUrl,
        sharedKeys,
        tenantKeys,
        tenant: process.env.TENANT, // tenantKeys가 있을 때만 필수
        log: l,
    });

    const tenant = String(process.env.TENANT ?? "").trim();
    if (!tenant) {
        l.error("[worker:init] TENANT가 비어있음");
        throw new Error("TENANT가 비어있음");
    }

    l.info(
        `[worker:init] vault ok isDev=${isDev} shared=${sharedKeys.length} tenant=${tenantKeys.length} tenantName=${tenant}`
    );

    // ✅ 이제 worker는 Redis Streams만 소비 (SQS/SNS/dev bridge 모름)
    const ac = new AbortController();
    process.on("SIGINT", () => ac.abort());
    process.on("SIGTERM", () => ac.abort());

    // TODO: 여기서 Redis Streams consumer 시작
    // await startTenantRedisConsumer({ tenantKey: tenant, signal: ac.signal, log: l });

    l.info(`[worker:init] consumer 시작 tenant=${tenant} (Redis Streams only)`);
}
