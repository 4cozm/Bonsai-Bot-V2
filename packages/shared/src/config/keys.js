// packages/shared/src/config/keys.js

function envName(isDev) {
    return isDev ? "dev" : "prod";
}

export const ENV_REQUIRED = Object.freeze({
    master: Object.freeze({
        common: Object.freeze([
            //AWS SNS 관련
            "AWS_REGION",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SNS_TOPIC",
            "REDIS_URL",
        ]),
        dev: Object.freeze([
            // dev master 전용
            "DEV_SQS_QUEUE_URL",
        ]),
        prod: Object.freeze([
            // prod master 전용

            //Discord 관련 작업을 위해서
            "DISCORD_APP_ID",
            "DISCORD_TOKEN",
            "DISCORD_TENANT_MAP",
            "DISCORD_GUILD_ID",
            //AWS SNS 관련
            "DEV_DISCORD_MAP",

            //AWS result SQS 풀링 관련
            "PROD_SQS_RESULT_QUEUE_URL",
        ]),
    }),

    worker: Object.freeze({
        common: Object.freeze([
            "REDIS_URL",
            "ESI_STATE_SECRET",
            // 테넌트 DB 연결 (getPrisma): 둘 중 하나 필수. Key Vault 공통
            "TENANT_DB_URL_TEMPLATE",
            "DATABASE_URL",
            // 워커 부팅 시 테넌트 DB 없으면 CREATE DATABASE용. Key Vault 공통
            "MYSQL_ADMIN_URL",
            // 개발환경에서는 스스로 발급해서 로컬 .env에 저장
            /**
             * EVE_ESI_CLIENT_ID=
             * EVE_ESI_CLIENT_SECRET=
             * EVE_ESI_REDIRECT_URI=
             */
        ]),
        dev: Object.freeze([
            // dev worker 전용
        ]),
        prod: Object.freeze([
            "EVE_ESI_CLIENT_ID",
            "EVE_ESI_CLIENT_SECRET",
            "EVE_ESI_REDIRECT_URI",
            "EVE_ESI_SCOPE",
            "DISCORD_ALERT_WEBHOOK_URL",
        ]),
    }),

    global: Object.freeze({
        common: Object.freeze([
            "REDIS_URL",
            // 콜백에서 getPrisma(tenantKey)용. Key Vault 공통 (dev/prod 동일 키 로딩)
            "TENANT_DB_URL_TEMPLATE",
            "DATABASE_URL",
            // global은 DB 생성 안 함. 단, Key Vault에 넣어둔 경우 로딩만 함
            "MYSQL_ADMIN_URL",
        ]),
        dev: Object.freeze([]),
        prod: Object.freeze([
            "DISCORD_DT_WEBHOOK_URL",
            "DISCORD_IT_PING_WEBHOOK_URL",
            "DISCORD_ALERT_WEBHOOK_URL",
            "ESI_STATE_SECRET",
            "EVE_ESI_CLIENT_ID",
            "EVE_ESI_CLIENT_SECRET",
            "EVE_ESI_REDIRECT_URI",
            "EVE_ESI_SCOPE",
        ]),
    }),
});

/**
 * 테넌트 prefix가 필요한 키 (tenant마다 값이 달라지는 것만)
 * - CAT-*, FISH-* 로 KeyVault에 저장
 */
export const WORKER_TENANT_REQUIRED = Object.freeze([
    // 예: "앵커꼽 ID"
    "EVE_ANCHOR_CHARIDS",
]);

//--------------------------------------------------------

/**
 * 역할별 KeyVault 로딩 키 세트 반환.
 * - sharedKeys: global/common + role/common + role/dev|prod
 * - tenantKeys: worker만 (WORKER_TENANT_REQUIRED)
 *
 * @param {{role:"master"|"worker"|"global", isDev:boolean}} ctx
 * @returns {{sharedKeys:string[], tenantKeys:string[]}}
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
