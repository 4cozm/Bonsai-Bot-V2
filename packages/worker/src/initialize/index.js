import { createRedisClient, loadVaultSecrets } from "@bonsai/external";
import { keySetsFor, loadEsiConfig, logger } from "@bonsai/shared";
import { disconnectPrisma } from "@bonsai/shared/db";
import dotenv from "dotenv";
import { runRedisStreamsCommandConsumer } from "../bus/redisStreamsCommandConsumer.js";
import { ensureTenantDbAndMigrate, getPrisma } from "../db/prisma.js";

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
 * worker 초기화 + Redis Streams 소비 시작
 * @param {{log?: {info:Function,warn:Function,error:Function}}} [opts]
 */
export async function initializeWorker(opts = {}) {
    const log = opts.log ?? logger();

    loadDotenvOnce();
    const isDev = isDevMode();
    const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;

    const { sharedKeys, tenantKeys } = keySetsFor({ role: "worker", isDev });

    // #region agent log
    const hasTPre = Boolean(process.env.TENANT_DB_URL_TEMPLATE?.trim());
    const hasDPre = Boolean(process.env.DATABASE_URL?.trim());
    fetch("http://127.0.0.1:7242/ingest/7070e61a-5c08-41bb-b8db-31b1f8c2675e", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            location: "worker/initialize:beforeVault",
            message: "worker init before loadVaultSecrets",
            data: {
                isDev,
                sharedKeysCount: sharedKeys.length,
                hasTenantDbInSharedKeys: sharedKeys.includes("TENANT_DB_URL_TEMPLATE"),
                hasDatabaseUrlInSharedKeys: sharedKeys.includes("DATABASE_URL"),
                envHasTenantDbUrlTemplate: hasTPre,
                envHasDatabaseUrl: hasDPre,
            },
            timestamp: Date.now(),
            sessionId: "debug-session",
            hypothesisId: "B",
        }),
    }).catch(() => {});
    // #endregion

    await loadVaultSecrets({
        vaultUrl,
        sharedKeys,
        tenantKeys,
        tenant: process.env.TENANT,
        log,
    });

    // #region agent log
    const hasTPost = Boolean(process.env.TENANT_DB_URL_TEMPLATE?.trim());
    const hasDPost = Boolean(process.env.DATABASE_URL?.trim());
    fetch("http://127.0.0.1:7242/ingest/7070e61a-5c08-41bb-b8db-31b1f8c2675e", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            location: "worker/initialize:afterVault",
            message: "worker init after loadVaultSecrets",
            data: {
                envHasTenantDbUrlTemplate: hasTPost,
                envHasDatabaseUrl: hasDPost,
            },
            timestamp: Date.now(),
            sessionId: "debug-session",
            hypothesisId: "C",
        }),
    }).catch(() => {});
    // #endregion

    const tenantKey = String(process.env.TENANT ?? "").trim();
    if (!tenantKey) {
        log.error("[worker:init] TENANT가 비어있음");
        throw new Error("TENANT가 비어있음");
    }

    log.info(
        `[worker:init] vault ok isDev=${isDev} tenant=${tenantKey} sharedKeys=${sharedKeys.length} tenantKeys=${tenantKeys.length}`
    );

    loadEsiConfig();

    const redis = await createRedisClient();
    await ensureTenantDbAndMigrate({ redis, tenantKey, log });
    const prisma = getPrisma(tenantKey);

    const ac = new AbortController();
    const shutdown = async (sig) => {
        log.info(`[worker:init] 종료 요청(${sig})`);
        ac.abort();
        try {
            await redis.quit();
        } catch {
            //무시
        }
        try {
            await disconnectPrisma(tenantKey);
        } catch {
            //무시
        }
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    await runRedisStreamsCommandConsumer({
        redis,
        prisma,
        tenantKey,
        signal: ac.signal,
        group: "bonsai-worker",
        consumer: `w-${tenantKey}-${process.pid}`,
    });
}
