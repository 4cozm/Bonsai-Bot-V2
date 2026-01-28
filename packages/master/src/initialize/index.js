// packages/master/src/initialize/index.js
import { loadVaultSecrets } from "@bonsai/external";
import { logger } from "@bonsai/shared";
import dotenv from "dotenv";

const VAULT_URL_DEV = "https://bonsai-bot-dev.vault.azure.net/";
const VAULT_URL_PROD = "https://bonsai-bot.vault.azure.net/";

const REQUIRED_MASTER = ["DISCORD_TOKEN", "DISCORD_GUILD_ID"];

let dotenvLoaded = false;
function loadDotenvOnce() {
    if (dotenvLoaded) return;
    dotenvLoaded = true;
    dotenv.config();
}

export async function initializeMaster({ log } = {}) {
    const l = log ?? logger();
    loadDotenvOnce();

    const isDev = String(process.env.isDev || "").toLowerCase() === "true";
    const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;

    await loadVaultSecrets({ vaultUrl, requiredKeys: REQUIRED_MASTER, log: l });
}
