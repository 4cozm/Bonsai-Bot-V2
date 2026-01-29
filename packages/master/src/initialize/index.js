// packages/master/src/initialize/index.js
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
export async function initializeMaster(opts = {}) {
    const log = opts.log ?? logger();

    loadDotenvOnce();

    const isDev = isDevMode();
    const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;

    const { sharedKeys, tenantKeys } = keySetsFor({ role: "master", isDev });

    await loadVaultSecrets({
        vaultUrl,
        sharedKeys,
        tenantKeys, // master는 보통 []
        log,
    });


    log.info(
        `[master:init] vault ok (isDev=${isDev}) keys=${sharedKeys.length}${
            tenantKeys?.length ? `+tenant(${tenantKeys.length})` : ""
        }`
    );
}
