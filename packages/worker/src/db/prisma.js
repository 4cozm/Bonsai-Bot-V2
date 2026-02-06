// packages/worker/src/db/prisma.js
/**
 * 테넌트 DB: 없으면 생성 + migrate(락 적용) 후 getPrisma. 부팅 시 DB 검증(fail-fast).
 */
import { buildTenantDbUrl, getPrisma, getTenantDbName } from "@bonsai/shared/db";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATE_LOCK_TTL_SEC = Number(process.env.TENANT_MIGRATE_LOCK_TTL_SEC ?? "300");
const MIGRATE_LOCK_KEY_PREFIX = "bonsai:migrate:lock:";

/**
 * DATABASE_URL에서 앱 사용자명 추출 (mysql://user:password@host/...).
 * @returns {string} 빈 문자열이면 추출 실패
 */
function getAppDbUser() {
    const url = String(process.env.DATABASE_URL ?? "").trim();
    const m = url.match(/\/\/([^:@]+)(?::[^@]*)?@/);
    return m ? String(m[1]).trim() : "";
}

/**
 * MYSQL_ADMIN_URL로 CREATE DATABASE IF NOT EXISTS 실행 후,
 * DATABASE_URL의 앱 사용자에게 해당 DB 권한 부여(GRANT). 권한 삭제/신규 테넌트 시에도 접근 가능.
 * @param {string} tenantKey
 * @param {{ log: { info: Function, warn: Function, error: Function } }} opts
 */
async function createTenantDbIfNotExists(tenantKey, opts) {
    const adminUrl = String(process.env.MYSQL_ADMIN_URL ?? "").trim();
    if (!adminUrl) {
        opts.log.warn("[db] MYSQL_ADMIN_URL 없음. DB 생성 생략(이미 존재한다고 가정).");
        return;
    }
    const dbName = getTenantDbName(tenantKey);
    const escapedDb = dbName.replace(/`/g, "``");
    const mysql2 = await import("mysql2/promise");
    const conn = await mysql2.createConnection(adminUrl);
    try {
        await conn.query(
            `CREATE DATABASE IF NOT EXISTS \`${escapedDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
        opts.log.info("[db] CREATE DATABASE 완료", { dbName });

        const appUser = getAppDbUser();
        if (appUser) {
            const safeUser = String(appUser).replace(/'/g, "''");
            await conn.query(`GRANT ALL PRIVILEGES ON \`${escapedDb}\`.* TO '${safeUser}'@'%'`);
            await conn
                .query(`GRANT ALL PRIVILEGES ON \`${escapedDb}\`.* TO '${safeUser}'@'localhost'`)
                .catch(() => {}); // localhost 계정 없으면 무시
            await conn.query("FLUSH PRIVILEGES");
            opts.log.info("[db] GRANT 완료", { dbName, user: appUser });
        } else {
            opts.log.warn("[db] DATABASE_URL에서 사용자 추출 실패. GRANT 생략.", { dbName });
        }
    } finally {
        await conn.end();
    }
}

/**
 * Redis 락 획득. 실패 시 throw.
 */
async function acquireMigrateLock(redis, tenantKey, log) {
    const key = MIGRATE_LOCK_KEY_PREFIX + tenantKey;
    const ok = await redis.set(key, process.pid + "", { NX: true, EX: MIGRATE_LOCK_TTL_SEC });
    if (!ok) {
        log.warn("[db] migrate 락 획득 실패(다른 프로세스가 실행 중?)", { tenantKey });
        throw new Error("테넌트 DB migrate 락 획득 실패. 잠시 후 재시도하세요.");
    }
}

function releaseMigrateLock(redis, tenantKey) {
    const key = MIGRATE_LOCK_KEY_PREFIX + tenantKey;
    return redis.del(key);
}

function findPrismaRoot() {
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
        if (fs.existsSync(path.join(dir, "prisma", "schema.prisma"))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return path.resolve(__dirname, "..", "..", "..");
}

/**
 * prisma migrate deploy를 tenant DB URL로 실행.
 * PM2 등에서 PATH에 npx가 없을 수 있으므로 node로 Prisma CLI 직접 실행.
 */
function runPrismaMigrateDeploy(tenantDbUrl, _log) {
    const root = findPrismaRoot();
    const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
    return new Promise((resolve, reject) => {
        const env = { ...process.env, DATABASE_URL: tenantDbUrl };
        const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
            cwd: root,
            env,
            stdio: "inherit",
        });
        child.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`prisma migrate deploy exited ${code}`));
        });
        child.on("error", reject);
    });
}

/**
 * TenantMeta upsert 후 fail-fast: 연결된 DB의 tenantKey와 일치하는지 검증.
 */
async function ensureAndValidateTenantMeta(prisma, tenantKey, log) {
    await prisma.tenantMeta.upsert({
        where: { tenantKey },
        create: { tenantKey },
        update: {},
    });
    const row = await prisma.tenantMeta.findFirst();
    if (!row || row.tenantKey !== tenantKey) {
        log.error("[db] fail-fast: 연결된 DB의 tenantKey가 이 워커와 불일치", {
            expected: tenantKey,
            got: row?.tenantKey ?? null,
        });
        process.exit(1);
    }
}

/**
 * 테넌트 DB가 없으면 생성, 락 잡고 migrate deploy, TenantMeta 검증 후 getPrisma 반환 가능하도록 준비.
 * 호출 후 getPrisma(tenantKey)로 클라이언트 획득.
 */
export async function ensureTenantDbAndMigrate({ redis, tenantKey, log }) {
    const validate = String(process.env.TENANT_DB_VALIDATE ?? "true").toLowerCase() === "true";

    await createTenantDbIfNotExists(tenantKey, { log });
    await acquireMigrateLock(redis, tenantKey, log);
    try {
        const tenantDbUrl = buildTenantDbUrl(tenantKey);
        await runPrismaMigrateDeploy(tenantDbUrl, log);
        const prisma = getPrisma(tenantKey);
        if (validate) {
            await ensureAndValidateTenantMeta(prisma, tenantKey, log);
        }
    } finally {
        await releaseMigrateLock(redis, tenantKey);
    }
}

export { getPrisma } from "@bonsai/shared/db";
