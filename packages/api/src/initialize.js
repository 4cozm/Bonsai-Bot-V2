// packages/api/src/initialize.js
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

/**
 * @param {{log?: {info:Function,warn:Function,error:Function}}} [opts]
 */
export async function initializeApi(opts = {}) {
    const log = opts.log ?? logger();

    loadDotenvOnce();

    const isDev = isDevMode();
    const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;

    const { sharedKeys, tenantKeys } = keySetsFor({ role: "api", isDev });

    await loadVaultSecrets({
        vaultUrl,
        sharedKeys,
        tenantKeys, // api는 항상 []
        log,
    });

    log.info(`[api:init] vault ok (isDev=${isDev}) keys=${sharedKeys.length}`);
}
