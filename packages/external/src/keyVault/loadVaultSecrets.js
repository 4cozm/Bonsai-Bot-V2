// packages/external/src/keyvault/loadVaultSecrets.js
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

function isBlank(v) {
    return v == null || String(v).trim() === "";
}

function toVaultKeyBase(envKey) {
    return String(envKey).replace(/_/g, "-");
}

function sharedVaultName(envKey) {
    return toVaultKeyBase(envKey);
}

function tenantVaultName(tenant, envKey) {
    const t = String(tenant).trim().toUpperCase();
    return `${t}-${toVaultKeyBase(envKey)}`;
}

function isNotFound(err) {
    const status = err?.statusCode ?? err?.status;
    const code = err?.code;
    return status === 404 || code === "SecretNotFound";
}

async function getSecretRequired(client, vaultName) {
    try {
        const s = await client.getSecret(vaultName);
        const v = s?.value;
        if (isBlank(v)) throw new Error(`Key Vault 값이 비어있습니다(필수): ${vaultName}`);
        return v;
    } catch (err) {
        if (isNotFound(err)) throw new Error(`Key Vault 시크릿이 없습니다(필수): ${vaultName}`);
        throw new Error(
            `Key Vault 시크릿 로드 실패: ${vaultName}\n사유: ${err?.message ?? String(err)}`
        );
    }
}

/**
 * KeyVault에서 시크릿을 읽어 process.env에 주입한다.
 * - sharedKeys: 공용 네임스페이스로 로드
 * - tenantKeys: TENANT 프리픽스 네임스페이스로 로드(CAT-*, FISH-* 등)
 *
 * @param {object} params
 * @param {string} params.vaultUrl
 * @param {string[]} [params.sharedKeys]
 * @param {string[]} [params.tenantKeys]
 * @param {string} [params.tenant] (tenantKeys가 있을 때 필수)
 * @param {{info:Function,warn:Function,error:Function}} [params.log]
 * @returns {Promise<void>}
 */
export async function loadVaultSecrets(params) {
    const { vaultUrl, sharedKeys = [], tenantKeys = [], tenant, log } = params;

    if (isBlank(vaultUrl)) throw new Error("vaultUrl이 비어있습니다.");

    const client = new SecretClient(vaultUrl, new DefaultAzureCredential());

    if (sharedKeys.length) {
        log?.info?.(`[vault] shared 로딩: ${sharedKeys.length}개`);
        for (const envKey of sharedKeys) {
            const vaultName = sharedVaultName(envKey);
            process.env[envKey] = await getSecretRequired(client, vaultName);
        }
    }

    if (tenantKeys.length) {
        const t = String(tenant || "").trim();
        if (!t) throw new Error("tenantKeys가 있는데 TENANT가 없습니다.");

        log?.info?.(`[vault] tenant(${t}) 로딩: ${tenantKeys.length}개`);
        for (const envKey of tenantKeys) {
            const vaultName = tenantVaultName(t, envKey);
            process.env[envKey] = await getSecretRequired(client, vaultName);
        }
    }
}
