// packages/shared/src/config/keys.js

function envName(isDev) {
    return isDev ? "dev" : "prod";
}

export const ENV_REQUIRED = Object.freeze({
    master: Object.freeze({
        common: Object.freeze([
            // master 공용
        ]),
        dev: Object.freeze([
            // dev master 전용
            // 기본적으로 마스터는 개발환경에서 동작 안한다
        ]),
        prod: Object.freeze([
            // prod master 전용

            //Discord 관련 작업을 위해서
            "DISCORD_APP_ID",
            "DISCORD_TOKEN",
            "DISCORD_TENANT_MAP",

            //AWS SNS 관련
            "AWS_REGION",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SNS_TOPIC",
            "DEV_DISCORD_MAP",
        ]),
    }),

    worker: Object.freeze({
        common: Object.freeze([
            // worker 공용 (tenant 무관)
        ]),
        dev: Object.freeze([
            // dev worker 전용

            //AWS SQS 소비를 위해 필요
            "AWS_REGION",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "DEV_SQS_QUEUE_URL",
        ]),
        prod: Object.freeze([
            // prod worker 전용
        ]),
    }),

    global: Object.freeze({
        common: Object.freeze([
            // master/worker 공통
            "DISCORD_GUILD_ID",
        ]),
        dev: Object.freeze([]),
        prod: Object.freeze(["DISCORD_WEBHOOK_URL"]),
    }),
});

/**
 * 테넌트 prefix가 필요한 키 (tenant마다 값이 달라지는 것만)
 * - CAT-*, FISH-* 로 KeyVault에 저장
 */
export const WORKER_TENANT_REQUIRED = Object.freeze([
    // 예: "앵커꼽 ID"
]);

//--------------------------------------------------------

/**
 * 역할별 KeyVault 로딩 키 세트 반환.
 * - sharedKeys: global/common + role/common + role/dev|prod
 * - tenantKeys: worker만 (WORKER_TENANT_REQUIRED)
 *
 * @param {{role:"master"|"worker", isDev:boolean}} ctx
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

    throw new Error(`unknown role: ${role}`);
}
