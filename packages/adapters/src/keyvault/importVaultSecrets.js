import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import "dotenv/config";
import ora from "ora";

const VAULT_URL_DEV = "https://bonsai-bot-dev.vault.azure.net/";
const VAULT_URL_PROD = "https://bonsai-bot.vault.azure.net/";

// dev/prod 공통으로 항상 필요한 키들
const REQUIRED_BOTH = [
    "DISCORD_WEBHOOK_URL",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
];

// dev 전용 필수
const REQUIRED_DEV = ["DEV_DISCORD_MAP","DEV-SQS-QUEUE-URL"];

// prod 전용 필수
const REQUIRED_PROD = ["DISCORD_GUILD_ID", "DISCORD_APP_ID", "DISCORD_TOKEN","AWS_SNS_TOPIC"];

// 테넌트 키 (Vault에서 FISH , CAT 으로 prefix)
const TENANT_REQUIRED_KEYS = [];
const TENANT_OPTIONAL_KEYS = [];

function isBlank(v) {
    return v == null || String(v).trim() === "";
}

function die(spinner, msg) {
    if (spinner) spinner.fail("초기화 실패");
    console.error(`\n${msg}\n`);
    process.exit(1);
}

function parseIsDev(raw) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
}

function readTenant() {
    const t = (process.env.TENANT || "").trim().toLowerCase();
    if (!t) return null;
    if (t !== "cat" && t !== "fish") return null;
    return t;
}

function toVaultKeyBase(envKey) {
    return envKey.replace(/_/g, "-");
}

function sharedVaultName(envKey) {
    return toVaultKeyBase(envKey);
}

function tenantVaultName(tenant, envKey) {
    return `${tenant.toUpperCase()}-${toVaultKeyBase(envKey)}`;
}

function isNotFound(err) {
    const status = err?.statusCode ?? err?.status;
    const code = err?.code;
    return status === 404 || code === "SecretNotFound";
}

async function getSecretRequired(client, spinner, vaultName) {
    try {
        const s = await client.getSecret(vaultName);
        const v = s?.value;
        if (isBlank(v)) die(spinner, `Key Vault 값이 비어있습니다(필수): ${vaultName}`);
        return v;
    } catch (err) {
        if (isNotFound(err)) die(spinner, `Key Vault 시크릿이 없습니다(필수): ${vaultName}`);
        die(
            spinner,
            `Key Vault 시크릿 로드 실패: ${vaultName}\n사유: ${err?.message ?? String(err)}`
        );
    }
}

async function getSecretOptional(client, spinner, vaultName) {
    try {
        const s = await client.getSecret(vaultName);
        const v = s?.value;
        if (isBlank(v)) return null;
        return v;
    } catch (err) {
        if (isNotFound(err)) return null;
        die(
            spinner,
            `Key Vault 시크릿 로드 실패: ${vaultName}\n사유: ${err?.message ?? String(err)}`
        );
    }
}

function readRunMode() {
    const m = (process.env.RUN_MODE || "").trim().toLowerCase();
    if (!m) return "master"; // 기본은 마스터로 취급
    if (m === "master" || m === "tenant-worker") return m;
    return null;
}

export async function importVaultSecrets() {
    const spinner = ora({ text: "Key Vault 환경변수 로딩 중...", spinner: "dots" }).start();

    const isDev = parseIsDev(process.env.isDev);
    if (isDev === null) die(spinner, "루트 .env에는 isDev=true 또는 isDev=false 만 있어야 합니다.");

    const runMode = readRunMode();
    if (!runMode) die(spinner, "RUN_MODE는 master 또는 tenant-worker 만 허용됩니다.");

    // tenant-worker에서만 TENANT 강제
    const tenant = runMode === "tenant-worker" ? readTenant() : null;
    if (runMode === "tenant-worker" && !tenant) {
        die(
            spinner,
            "TENANT가 없습니다. tenant-worker는 TENANT=cat 또는 TENANT=fish 가 필요합니다."
        );
    }

    const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;
    if (isBlank(vaultUrl)) die(spinner, "Key Vault URL이 코드에 설정되지 않았습니다.");

    spinner.text = `Vault 연결 중... (${isDev ? "dev" : "prod"} / mode=${runMode}${tenant ? ` / tenant=${tenant}` : ""})`;
    const client = new SecretClient(vaultUrl, new DefaultAzureCredential());

    // 1) 필수 키 로드: dev에서는 prod 전용 키를 아예 시도하지 않음
    const required = [
        ...REQUIRED_BOTH,
        ...(isDev ? REQUIRED_DEV : REQUIRED_PROD),
        ...TENANT_REQUIRED_KEYS,
    ];

    spinner.text = "필수 환경변수 로딩 중...";
    for (const envKey of required) {
        const vaultName = sharedVaultName(envKey);
        process.env[envKey] = await getSecretRequired(client, spinner, vaultName);
    }

    // 2) 테넌트 모드일때 실행
    if (runMode === "tenant-worker") {
        spinner.text = `테넌트 환경변수 로딩 중... (${tenant})`;
        for (const envKey of TENANT_REQUIRED_KEYS) {
            const vaultName = tenantVaultName(tenant, envKey);
            process.env[envKey] = await getSecretRequired(client, spinner, vaultName);
        }
        for (const envKey of TENANT_OPTIONAL_KEYS) {
            const vaultName = tenantVaultName(tenant, envKey);
            const v = await getSecretOptional(client, spinner, vaultName);
            if (!isBlank(v)) process.env[envKey] = v;
        }
    }

    // 3) 최종 검증
    const missing = required.filter((k) => isBlank(process.env[k]));
    if (missing.length) die(spinner, `필수 환경변수가 채워지지 않았습니다: ${missing.join(", ")}`);

    spinner.succeed(`환경변수 로딩 완료 (${isDev ? "dev" : "prod"} / tenant=${tenant})`);
}
