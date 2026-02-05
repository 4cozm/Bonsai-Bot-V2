import { createRedisClient, loadVaultSecrets } from "@bonsai/external";
import { keySetsFor, loadEsiConfig, logger } from "@bonsai/shared";
import dotenv from "dotenv";
import { runRedisStreamsGlobalConsumer } from "../bus/redisStreamsGlobalConsumer.js";
import { startEsiCallbackServer } from "../esi/esiCallbackServer.js";
import { startDtScheduler } from "../schedulers/dtScheduler.js";

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
 * 글로벌 오케스트레이터 초기화 + Redis Streams 소비 시작.
 *
 * - tenantKey가 아니라 __global__ 스트림을 소비한다.
 * - 전역 스케줄/집계/단일 싱크(webhook 1개) 작업을 담당한다.
 */
export async function initializeOrchestrator() {
    const log = logger();

    loadDotenvOnce();
    const isDev = isDevMode();
    const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;

    const { sharedKeys } = keySetsFor({ role: "global", isDev });

    await loadVaultSecrets({
        vaultUrl,
        sharedKeys,
        tenantKeys: [],
        tenant: "__global__",
        log,
    });

    log.info(`[global:init] vault ok isDev=${isDev} sharedKeys=${sharedKeys.length}`);

    loadEsiConfig();

    const redis = await createRedisClient();

    // EVE OAuth 콜백: 테넌트 무관 전역 HTTP. 포트 3000 고정. prisma는 state의 tenantKey로 getPrisma(tenantKey) 사용.
    startEsiCallbackServer({ redis, port: 3000 });

    const ac = new AbortController();
    const shutdown = async (sig) => {
        log.info(`[global:init] 종료 요청(${sig})`);
        ac.abort();
        try {
            await redis.quit();
        } catch {
            //무시
        }
        try {
            const { disconnectPrisma } = await import("@bonsai/shared/db");
            await disconnectPrisma();
        } catch {
            //무시
        }
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    if (isDev) {
        log.info("[global:init] 개발 환경에서는 스케줄러 미동작");
    } else {
        await startDtScheduler({ redis, signal: ac.signal });
    }

    await runRedisStreamsGlobalConsumer({
        redis,
        signal: ac.signal,
        group: "bonsai-global",
        consumer: `g-${process.pid}`,
    });
}
