// packages/shared/src/config/keys.js

/**
 * Key Vault 로딩용 환경 변수 키 정의.
 *
 * --- 역할(role) ---
 * - master: Discord 게이트웨이 (슬래시 명령 수신, SQS/Streams 발행).
 * - worker: Redis Streams 소비. TENANT=CAT|FISH|... 이면 테넌트 워커, TENANT=global 이면 전역(시세 등) 전용 워커.
 * - global: 오케스트레이터(Orchestrator). 전역 스케줄·ESI 콜백·전역 스트림 소비. (역할 이름이 "global"이지만 "global worker"와 구분됨.)
 *
 * --- sharedKeys vs tenantKeys ---
 * - sharedKeys: Key Vault에서 접두이 없이 로드해 process.env[키]에 주입. 모든 역할에서 "오케스트레이터용 키 + 해당 역할 전용 키"가 합쳐짐.
 * - tenantKeys: 테넌트 워커만 사용. Vault 이름이 {TENANT}-{KEY}(예: CAT-EVE-ANCHOR-CHARIDS). 오케스트레이터 및 TENANT=global 워커는 로드하지 않음(worker 초기화에서 빈 배열로 덮어씀).
 */

function envName(isDev) {
    return isDev ? "dev" : "prod";
}

/**
 * 역할별 필수 env 키. Key Vault 로드 시 keySetsFor()에서 사용.
 * - global: 오케스트레이터 프로세스용. sharedKeys 산출 시 모든 role에 선행 병합됨(중복 키는 역할별로 한 번씩만 로드).
 */
export const ENV_REQUIRED = Object.freeze({
    // master = Discord Master 전용
    master: Object.freeze({
        common: Object.freeze([
            "AWS_REGION",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SNS_TOPIC",
            "REDIS_URL",
        ]),
        dev: Object.freeze(["DEV_SQS_QUEUE_URL"]),
        prod: Object.freeze([
            "DISCORD_APP_ID",
            "DISCORD_TOKEN",
            "DISCORD_TENANT_MAP",
            "DISCORD_GUILD_ID",
            "DEV_DISCORD_MAP",
            "PROD_SQS_RESULT_QUEUE_URL",
        ]),
    }),

    // worker = 테넌트 워커(TENANT=CAT 등) 전용. TENANT=global 워커도 role "worker"로 호출하나 tenantKeys는 초기화에서 비움.
    worker: Object.freeze({
        common: Object.freeze([
            "REDIS_URL",
            "ESI_STATE_SECRET",
            "TENANT_DB_URL_TEMPLATE",
            "DATABASE_URL",
            "MYSQL_ADMIN_URL",
        ]),
        dev: Object.freeze([]),
        prod: Object.freeze([
            "EVE_ESI_CLIENT_ID",
            "EVE_ESI_CLIENT_SECRET",
            "EVE_ESI_REDIRECT_URI",
            "EVE_ESI_SCOPE",
        ]),
    }),

    // global = 오케스트레이터(Orchestrator) 전용. sharedKeys 계산 시 이 키들이 모든 role에 선행 병합됨.
    global: Object.freeze({
        common: Object.freeze([
            "REDIS_URL",
            "TENANT_DB_URL_TEMPLATE",
            "DATABASE_URL",
            "MYSQL_ADMIN_URL",
        ]),
        dev: Object.freeze([]),
        prod: Object.freeze([
            "DISCORD_TENANT_MAP",
            "DISCORD_DT_WEBHOOK_URL",
            "DISCORD_IT_PING_WEBHOOK_URL",
            "DISCORD_ALERT_WEBHOOK_URL",
            "SLOW_MINMATAR_WEBHOOK_URL",
            "ESI_STATE_SECRET",
            "EVE_ESI_CLIENT_ID",
            "EVE_ESI_CLIENT_SECRET",
            "EVE_ESI_REDIRECT_URI",
            "EVE_ESI_SCOPE",
        ]),
    }),
});

/**
 * 테넌트 워커 전용. Vault에 {TENANT}-{KEY}(예: CAT-EVE-ANCHOR-CHARIDS)로 저장.
 * 오케스트레이터 및 TENANT=global 워커는 사용하지 않음(worker 초기화에서 tenantKeys를 빈 배열로 덮어씀).
 */
export const WORKER_TENANT_REQUIRED = Object.freeze([
    "EVE_ANCHOR_CHARIDS",
    // TODO: dev Key Vault에 미등록 — .env 더미값으로 대체 중. 프로덕션 배포 전 복구 필요.
    // "TENANT_ALERT_WEBHOOK_URL",
]);

//--------------------------------------------------------

/**
 * 역할별 KeyVault 로딩 키 세트 반환.
 *
 * @param {object} ctx
 * @param {"master"|"worker"|"global"} ctx.role - master: Discord Master | worker: Tenant/Global Worker | global: Orchestrator
 * @param {boolean} ctx.isDev
 * @returns {{sharedKeys:string[], tenantKeys:string[]}}
 * @returns {string[]} sharedKeys - 오케스트레이터용 키 + 역할별 키. Vault 공용 네임스페이스(접두이 없이 로드).
 * @returns {string[]} tenantKeys - 테넌트 접두이로 로드할 키. worker만 비어 있지 않음(worker 초기화에서 TENANT=global이면 []로 덮어씀).
 */
export function keySetsFor(ctx) {
    const env = envName(ctx.isDev);
    const role = ctx.role;

    const globalKeys = [
        ...(ENV_REQUIRED.global.common ?? []),
        ...(ENV_REQUIRED.global?.[env] ?? []),
    ];

    const roleKeys = [...(ENV_REQUIRED[role]?.common ?? []), ...(ENV_REQUIRED[role]?.[env] ?? [])];

    if (role === "master") {
        return {
            sharedKeys: [...globalKeys, ...roleKeys],
            tenantKeys: [],
        };
    }

    if (role === "worker") {
        return {
            sharedKeys: [...globalKeys, ...roleKeys],
            tenantKeys: [...WORKER_TENANT_REQUIRED],
        };
    }

    if (role === "global") {
        return {
            sharedKeys: [...globalKeys, ...roleKeys],
            tenantKeys: [],
        };
    }

    throw new Error(`unknown role: ${role}`);
}
