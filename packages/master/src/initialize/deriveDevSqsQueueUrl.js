// packages/master/src/initialize/deriveDevSqsQueue.js
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Azure 로그인 계정의 식별 문자열(이메일/UPN 등)을 토큰 클레임에서 추출한다.
 * @returns {Promise<string>}
 */
export async function getAzureSignedInIdentity() {
    const cred = new DefaultAzureCredential();
    const token = await cred.getToken("https://management.azure.com/.default");
    if (!token?.token) throw new Error("Azure 토큰을 가져오지 못했습니다.");

    const parts = token.token.split(".");
    if (parts.length < 2) throw new Error("JWT 토큰 형식이 아닙니다.");

    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);

    const v = payload.preferred_username || payload.upn || payload.unique_name || payload.email;
    if (!v)
        throw new Error(
            "토큰에서 식별 클레임(preferred_username/upn/unique_name/email)을 찾지 못했습니다."
        );

    return String(v).trim();
}

/**
 * identity 문자열에서 devKey를 정규화한다.
 * - "17328rm@gmail.com"          -> "17328rm"
 * - "live.com#17328rm"           -> "17328rm"
 * - "live.com#17328rm@gmail.com" -> "17328rm"
 *
 * @param {string} identity
 * @returns {string}
 */
export function deriveDevKey(identity) {
    let v = String(identity || "").trim();
    if (!v) throw new Error("dev 식별 문자열이 비어있습니다.");

    const hashIdx = v.lastIndexOf("#");
    if (hashIdx >= 0 && hashIdx < v.length - 1) v = v.slice(hashIdx + 1).trim();

    const atIdx = v.indexOf("@");
    if (atIdx > 0) v = v.slice(0, atIdx).trim();

    if (!v) throw new Error("devKey를 추출할 수 없습니다.");
    return v;
}

/**
 * DEV_SQS_QUEUE_URL(prefix) + devKey 를 붙여 queueUrl을 만든다.
 *
 * @param {object} params
 * @param {string} params.prefix
 * @param {string} params.devKey
 * @returns {string}
 */
export function buildDevSqsQueueUrl({ prefix, devKey }) {
    const p = String(prefix || "").trim();
    const k = String(devKey || "").trim();
    if (!p) throw new Error("DEV_SQS_QUEUE_URL(prefix)가 비어있습니다.");
    if (!k) throw new Error("devKey가 비어있습니다.");
    return `${p}${k}`;
}
