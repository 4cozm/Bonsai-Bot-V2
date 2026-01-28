// packages/worker/src/initialize/deriveDevSqsQueueUrl.js
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Azure 로그인 계정의 이메일(또는 UPN)을 토큰 클레임에서 추출한다.
 * - 로컬 개발환경에서 DefaultAzureCredential이 Azure CLI/VSCode 로그인을 물고 있는 경우가 많다.
 * - 서명 검증 목적이 아니라 "현재 사용자 식별 문자열" 확보 목적이다.
 *
 * @returns {Promise<string>} 예: "17328@gmail.com"
 */
export async function getAzureSignedInEmail() {
    const cred = new DefaultAzureCredential();

    // Management scope는 대부분의 credential 소스에서 잘 나옴
    const token = await cred.getToken("https://management.azure.com/.default");
    if (!token?.token) throw new Error("Azure 토큰을 가져오지 못했습니다.");

    const parts = token.token.split(".");
    if (parts.length < 2) throw new Error("JWT 토큰 형식이 아닙니다.");

    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);

    const email = payload.preferred_username || payload.upn || payload.unique_name || payload.email;

    if (!email) throw new Error("토큰에서 이메일/UPN 클레임을 찾지 못했습니다.");

    return String(email).trim();
}

/**
 * DEV_SQS_QUEUE_URL(prefix) + 이메일 local-part를 붙여 SQS_QUEUE_URL을 만든다.
 *
 * @param {object} params
 * @param {string} params.prefix 예: "https://sqs.ap-northeast-2.amazonaws.com/273.../bonsai-bot-"
 * @param {string} params.email 예: "17328@gmail.com"
 * @returns {string} 예: "https://.../bonsai-bot-17328"
 */
export function buildDevSqsQueueUrl({ prefix, email }) {
    const p = String(prefix || "").trim();
    const e = String(email || "").trim();

    if (!p) throw new Error("DEV_SQS_QUEUE_URL(prefix)가 비어있습니다.");
    if (!e) throw new Error("이메일이 비어있습니다.");

    const local = e.split("@")[0]?.trim();
    if (!local) throw new Error(`이메일 local-part를 추출할 수 없습니다: ${e}`);

    return `${p}${local}`;
}
