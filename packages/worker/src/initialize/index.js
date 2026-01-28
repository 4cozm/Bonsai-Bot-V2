// packages/worker/src/initialize/index.js
import { loadVaultSecrets } from "@bonsai/external";
import { logger } from "@bonsai/shared";
import dotenv from "dotenv";

const VAULT_URL_DEV = "https://bonsai-bot-dev.vault.azure.net/";
const VAULT_URL_PROD = "https://bonsai-bot.vault.azure.net/";

const REQUIRED_WORKER = [
    "TENANT",
    // ... worker 전용 필수키
];

let dotenvLoaded = false;
function loadDotenvOnce() {
    if (dotenvLoaded) return;
    dotenvLoaded = true;
    dotenv.config();
}

/**
 * worker(tenant-worker) 초기화
 * - .env 로드
 * - KeyVault 시크릿 로드
 *
 * @param {{log?: {info:Function,warn:Function,error:Function}}} [opts]
 * @returns {Promise<void>}
 */
export async function initializeWorker(opts = {}) {
    const l = opts.log ?? logger();
    loadDotenvOnce();

    const isDev = String(process.env.isDev || "").toLowerCase() === "true";
    const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;

    await loadVaultSecrets({ vaultUrl, requiredKeys: REQUIRED_WORKER, log: l });
}
