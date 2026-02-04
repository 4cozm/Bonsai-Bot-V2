// packages/shared/src/db/getPrisma.js
/**
 * PrismaClient는 이 모듈을 통해서만 획득. new PrismaClient() 직접 호출 금지.
 * tenantKey → DB URL 결정 로직이 여기로 고정(핸들러가 임의로 DB명 지정 불가).
 */
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger.js";

const log = logger();
const cache = new Map();

const TENANT_DB_URL_TEMPLATE = String(
    process.env.TENANT_DB_URL_TEMPLATE ?? process.env.DATABASE_URL ?? ""
).trim();
const TENANT_DB_NAME_PREFIX = String(process.env.TENANT_DB_NAME_PREFIX ?? "bonsai_").trim();

export function sanitizeTenantKey(key) {
    return String(key ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * 테넌트 DB URL 생성. TENANT_DB_URL_TEMPLATE의 %s를 치환하거나, prefix+tenantKey로 DB명 구성.
 */
export function buildTenantDbUrl(tenantKey) {
    const safe = sanitizeTenantKey(tenantKey);
    if (!safe) throw new Error("tenantKey가 비어있거나 유효하지 않습니다.");
    if (TENANT_DB_URL_TEMPLATE && TENANT_DB_URL_TEMPLATE.includes("%s")) {
        return TENANT_DB_URL_TEMPLATE.replace("%s", safe);
    }
    if (!TENANT_DB_URL_TEMPLATE)
        throw new Error("TENANT_DB_URL_TEMPLATE 또는 DATABASE_URL이 필요합니다.");
    const base = TENANT_DB_URL_TEMPLATE.replace(/\/[^/]*$/, "").replace(/\/$/, "");
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
