// packages/shared/src/db/getPrisma.js
/**
 * PrismaClient는 이 모듈을 통해서만 획득. new PrismaClient() 직접 호출 금지.
 * tenantKey → DB URL 결정 로직이 여기로 고정(핸들러가 임의로 DB명 지정 불가).
 */
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger.js";

const log = logger();
const cache = new Map();

/** 호출 시점 process.env에서 읽음(Key Vault 로드 후 사용 가능). */
function getTenantDbUrlTemplate() {
    return String(process.env.TENANT_DB_URL_TEMPLATE ?? process.env.DATABASE_URL ?? "").trim();
}
const TENANT_DB_NAME_PREFIX = String(process.env.TENANT_DB_NAME_PREFIX ?? "bonsai_").trim();

// #region agent log
queueMicrotask(() => {
    const hasT = Boolean(process.env.TENANT_DB_URL_TEMPLATE?.trim());
    const hasD = Boolean(process.env.DATABASE_URL?.trim());
    fetch("http://127.0.0.1:7242/ingest/7070e61a-5c08-41bb-b8db-31b1f8c2675e", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            location: "getPrisma.js:moduleLoad",
            message: "getPrisma module load: env at load time",
            data: {
                runMode: process.env.RUN_MODE ?? "(undefined)",
                tenant: process.env.TENANT ?? "(undefined)",
                hasTenantDbUrlTemplate: hasT,
                hasDatabaseUrl: hasD,
                templateNowLength: getTenantDbUrlTemplate().length,
                templateNowEmpty: getTenantDbUrlTemplate() === "",
            },
            timestamp: Date.now(),
            sessionId: "debug-session",
            runId: "post-fix",
            hypothesisId: "A",
        }),
    }).catch(() => {});
});
// #endregion

export function sanitizeTenantKey(key) {
    return String(key ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * 테넌트 DB URL 생성. TENANT_DB_URL_TEMPLATE의 %s를 치환하거나, prefix+tenantKey로 DB명 구성.
 */
export function buildTenantDbUrl(tenantKey) {
    const safe = sanitizeTenantKey(tenantKey);
    if (!safe) throw new Error("tenantKey가 비어있거나 유효하지 않습니다.");
    const template = getTenantDbUrlTemplate();
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/7070e61a-5c08-41bb-b8db-31b1f8c2675e", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            location: "getPrisma.js:buildTenantDbUrl",
            message: "buildTenantDbUrl called",
            data: {
                templateEmpty: template === "",
                templateLength: template.length,
                processEnvHasTemplate: Boolean(process.env.TENANT_DB_URL_TEMPLATE?.trim()),
                processEnvHasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
            },
            timestamp: Date.now(),
            sessionId: "debug-session",
            runId: "post-fix",
            hypothesisId: "E",
        }),
    }).catch(() => {});
    // #endregion
    if (template && template.includes("%s")) {
        return template.replace("%s", safe);
    }
    if (!template) {
        throw new Error("TENANT_DB_URL_TEMPLATE 또는 DATABASE_URL이 필요합니다.");
    }
    const base = template.replace(/\/[^/]*$/, "").replace(/\/$/, "");
    const dbName = TENANT_DB_NAME_PREFIX + safe;
    return `${base}/${dbName}`;
}

/** 테넌트 DB 이름만 반환 (CREATE DATABASE용) */
export function getTenantDbName(tenantKey) {
    const safe = sanitizeTenantKey(tenantKey);
    if (!safe) throw new Error("tenantKey가 비어있거나 유효하지 않습니다.");
    return TENANT_DB_NAME_PREFIX + safe;
}

/**
 * 테넌트별 PrismaClient 반환(캐시). 중앙집중 생성만 허용.
 * @param {string} tenantKey
 * @returns {import("@prisma/client").PrismaClient}
 */
export function getPrisma(tenantKey) {
    const key = String(tenantKey ?? "").trim();
    if (!key) throw new Error("getPrisma: tenantKey가 비어있습니다.");
    if (cache.has(key)) return cache.get(key);
    const url = buildTenantDbUrl(key);
    const client = new PrismaClient({
        datasources: { db: { url } },
    });
    cache.set(key, client);
    log.info("[db] getPrisma 생성", { tenantKey: key });
    return client;
}

/**
 * 캐시된 클라이언트 연결 해제. 종료 시 호출.
 * @param {string} [tenantKey] - 생략 시 전체
 */
export async function disconnectPrisma(tenantKey) {
    if (tenantKey != null) {
        const c = cache.get(String(tenantKey));
        if (c) {
            await c.$disconnect();
            cache.delete(String(tenantKey));
        }
        return;
    }
    for (const [k, c] of cache) {
        try {
            await c.$disconnect();
        } catch (e) {
            log.warn("[db] disconnect 실패", { tenantKey: k }, e);
        }
    }
    cache.clear();
}
