// packages/shared/src/esi/parseEveEsiScope.js

const DEFAULT_SCOPE = "esi-character.read_character.v1";
const REQUIRED_MSG =
    "EVE_ESI_SCOPE가 필요합니다. (운영에서는 Key Vault에 JSON 배열 또는 공백 구분 문자열로 설정)";
const INVALID_JSON_MSG =
    "EVE_ESI_SCOPE JSON 형식이 잘못되었습니다. (JSON 배열 또는 공백 구분 문자열로 설정)";

/**
 * EVE_ESI_SCOPE 환경변수 값을 OAuth scope 문자열로 정규화한다.
 * - Key Vault에 JSON 배열로 저장된 경우: ["publicData","esi-..."] → "publicData esi-..."
 * - 공백 구분 문자열인 경우: 그대로 trim
 *
 * @param {string} [envValue] - process.env.EVE_ESI_SCOPE
 * @param {{ required?: boolean }} [options] - required: true면 scope가 비어 있을 때 throw (운영용)
 * @returns {string} 공백으로 구분된 scope 문자열 (EVE OAuth scope 파라미터용)
 */
export function parseEveEsiScope(envValue, options = {}) {
    const required = Boolean(options?.required);
    const raw = String(envValue ?? "").trim();

    if (!raw) {
        if (required) throw new Error(REQUIRED_MSG);
        return DEFAULT_SCOPE;
    }

    if (raw.startsWith("[")) {
        try {
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) {
                if (required) throw new Error(REQUIRED_MSG);
                return DEFAULT_SCOPE;
            }
            const parts = arr
                .filter((s) => s != null && String(s).trim() !== "")
                .map((s) => String(s).trim());
            if (parts.length === 0) {
                if (required) throw new Error(REQUIRED_MSG);
                return DEFAULT_SCOPE;
            }
            return parts.join(" ");
        } catch (err) {
            if (err instanceof Error && err.message === REQUIRED_MSG) throw err;
            if (required) throw new Error(INVALID_JSON_MSG);
            return raw;
        }
    }

    return raw;
}
