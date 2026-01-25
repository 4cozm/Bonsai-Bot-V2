import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import "dotenv/config";
import ora from "ora";

const VAULT_URL_DEV = "https://bonsai-bot-dev.vault.azure.net/";
const VAULT_URL_PROD = "https://bonsai-bot.vault.azure.net/";

// 공용 키
const SHARED_KEYS = ["DATABASE_URL", "REDIS_URL", "MYSQL_IP", "MYSQL_PASSWORD"];

// 테넌트 키
const TENANT_KEYS = ["DISCORD_SECRET", "SESSION_SECRET", "JWT_SECRET"];

function isBlank(v) {
  return v == null || String(v).trim() === "";
}

function die(spinner, msg) {
  if (spinner) spinner.fail("초기화 실패");
  console.error(`\n❌ ${msg}\n`);
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

async function getSecretOrDie(client, spinner, vaultName) {
  try {
    const s = await client.getSecret(vaultName);
    const v = s?.value;
    if (isBlank(v)) die(spinner, `Key Vault 값이 비어있습니다: ${vaultName}`);
    return v;
  } catch (err) {
    die(spinner, `Key Vault 시크릿 로드 실패: ${vaultName}\n사유: ${err?.message ?? String(err)}`);
  }
}

export async function importVaultSecrets() {
  const spinner = ora({ text: "🔐 Key Vault 환경변수 로딩 중...", spinner: "dots" }).start();

  const isDev = parseIsDev(process.env.isDev);
  if (isDev === null) die(spinner, "루트 .env에는 isDev=true 또는 isDev=false 만 있어야 합니다.");

  const tenant = readTenant();
  if (!tenant) die(spinner, "TENANT가 없습니다. PM2에서 TENANT=cat 또는 TENANT=fish 를 주입하세요.");

  const vaultUrl = isDev ? VAULT_URL_DEV : VAULT_URL_PROD;
  if (isBlank(vaultUrl)) die(spinner, "Key Vault URL이 코드에 설정되지 않았습니다.");

  spinner.text = `🔎 Vault 연결 중... (${isDev ? "개발" : "프로덕션"} / tenant=${tenant})`;

  const client = new SecretClient(vaultUrl, new DefaultAzureCredential());

  // 1) 공용 키 로드
  spinner.text = "📦 공용 환경변수 로딩 중...";
  for (const envKey of SHARED_KEYS) {
    const vaultName = sharedVaultName(envKey);
    process.env[envKey] = await getSecretOrDie(client, spinner, vaultName);
  }

  // 2) 테넌트 키 로드 (Vault에서만 prefix)
  spinner.text = `🐾 테넌트 환경변수 로딩 중... (${tenant})`;
  for (const envKey of TENANT_KEYS) {
    const vaultName = tenantVaultName(tenant, envKey);
    process.env[envKey] = await getSecretOrDie(client, spinner, vaultName);
  }

  // 3) 최종 검증
  const required = [...SHARED_KEYS, ...TENANT_KEYS];
  const missing = required.filter((k) => isBlank(process.env[k]));
  if (missing.length) die(spinner, `필수 환경변수가 채워지지 않았습니다: ${missing.join(", ")}`);

  spinner.succeed(`✅ 환경변수 로딩 완료 (${isDev ? "개발" : "프로덕션"} / tenant=${tenant})`);
}

export { SHARED_KEYS, TENANT_KEYS };
