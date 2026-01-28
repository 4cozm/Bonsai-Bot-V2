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

    l.info(
        `[worker:init] vault ok isDev=${isDev} shared=${sharedKeys.length} tenant=${tenantKeys.length} tenantName=${process.env.TENANT ?? "(none)"}`
    );
}
