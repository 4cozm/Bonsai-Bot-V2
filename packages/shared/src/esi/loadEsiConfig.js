// packages/shared/src/esi/loadEsiConfig.js
/**
 * ESI 설정 단일 로더. 여기서만 EVE_ESI_* / ESI_STATE_SECRET 읽기 및 dev 부트스트랩.
 * 운영(prod)에서는 EVE_ESI_REDIRECT_URI가 실제 콜백 URL과 정확히 일치해야 함
 * (예: https://esi.cat4u.shop/auth/eve/callback). 불일치 시 EVE SSO가 거부함.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import { parseEveEsiScope } from "./parseEveEsiScope.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = logger();
const STATE_SECRET_KEY = "ESI_STATE_SECRET";

function isDevEnvironment() {
    const n = String(process.env.NODE_ENV ?? "").toLowerCase();
    const isDev = String(process.env.isDev ?? "").toLowerCase() === "true";
    const runEnv = String(process.env.RUN_ENV ?? "").toLowerCase();
    return n === "development" || isDev || runEnv === "dev";
}

const ESI_CALLBACK_PORT = 3000;

function printEsiGuide() {
    const lines = [
        "",
        "========== EVE ESI 앱 발급 가이드 (개발용) ==========",
        "1. https://developers.eveonline.com/ 에서 애플리케이션 생성",
        "2. Application Type: 'Third Party Application' 또는 'CREST Application'",
        "3. Callback URL: 아래 REDIRECT_URI와 반드시 동일하게 입력",
        "   (한 글자라도 다르면 EVE SSO가 거부합니다.)",
        `   예: http://localhost:${ESI_CALLBACK_PORT}/auth/eve/callback`,
        "4. Scope: 최소 esi-character.read_character.v1 (필요 시 추가)",
        "5. 생성 후 Client ID / Secret Key를 복사해 .env에 붙여넣기",
        "   - EVE_ESI_CLIENT_ID= (발급된 Client ID)",
        "   - EVE_ESI_CLIENT_SECRET= (발급된 Secret Key, 노출 금지)",
        "6. .env에 추가된 placeholder를 위 값으로 교체한 뒤 재시작",
        "==================================================",
        "",
    ];
    process.stderr.write(lines.join("\n"));
}

/**
 * .env 파일에 누락된 키만 추가. 기존 값 덮어쓰지 않음.
 * @param {string} envPath
 * @param {Record<string, string>} toAdd
 * @returns {string[]} 추가된 키 목록
 */
function appendMissingEnv(envPath, toAdd) {
    const added = [];
    let content = "";
    try {
        content = fs.readFileSync(envPath, "utf8");
    } catch {
        content = "";
    }
    const lines = content ? content.split("\n") : [];
    const existingKeys = new Set();
    for (const line of lines) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (m) existingKeys.add(m[1]);
    }
    const toAppend = [];
    for (const [key, value] of Object.entries(toAdd)) {
        if (existingKeys.has(key)) continue;
        toAppend.push(`${key}=${value}`);
        added.push(key);
    }
    if (toAppend.length === 0) return added;
    const newContent =
        content.trimEnd() + (content.endsWith("\n") ? "" : "\n") + toAppend.join("\n") + "\n";
    fs.writeFileSync(envPath, newContent, "utf8");
    return added;
}

/**
 * 프로젝트 루트 .env 경로 추정 (packages/shared 기준으로 루트는 2단계 위)
 */
function resolveEnvPath() {
    const cwd = process.cwd();
    const candidates = [
        path.join(cwd, ".env"),
        path.join(__dirname, "..", "..", "..", ".env"),
        path.join(__dirname, "..", "..", ".env"),
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch {
            // ignore
        }
    }
    return path.join(cwd, ".env");
}

/**
 * ESI 설정 로드. dev에서 누락 시 가이드 출력 + .env 부트스트랩 후 예외.
 * prod에서는 누락 시 즉시 throw.
 * @returns {{ clientId: string, clientSecret: string, redirectUri: string, stateSecret: string, scope?: string }}
 */
function isPlaceholder(value) {
    const v = String(value ?? "");
    return (v.startsWith("<") && v.endsWith(">")) || /발급|복사|붙여넣기/.test(v);
}

export function loadEsiConfig() {
    const isDev = isDevEnvironment();
    const clientId = String(process.env.EVE_ESI_CLIENT_ID ?? "").trim();
    const clientSecret = String(process.env.EVE_ESI_CLIENT_SECRET ?? "").trim();
    const redirectUri = String(process.env.EVE_ESI_REDIRECT_URI ?? "").trim();
    const stateSecret = String(process.env.ESI_STATE_SECRET ?? "").trim();
    const scope = parseEveEsiScope(process.env.EVE_ESI_SCOPE, { required: !isDev });

    const missing = [];
    if (!clientId || isPlaceholder(clientId)) missing.push("EVE_ESI_CLIENT_ID");
    if (!clientSecret || isPlaceholder(clientSecret)) missing.push("EVE_ESI_CLIENT_SECRET");
    if (!redirectUri || isPlaceholder(redirectUri)) missing.push("EVE_ESI_REDIRECT_URI");

    if (missing.length === 0 && stateSecret) {
        return { clientId, clientSecret, redirectUri, stateSecret, scope };
    }

    if (!isDev) {
        if (missing.length) {
            log.error("[esi:config] 필수 ESI env 누락 (prod에서는 자동 생성 금지)", { missing });
            throw new Error(
                `ESI 설정 누락: ${missing.join(", ")}. EVE_ESI_REDIRECT_URI는 운영 콜백 URL과 정확히 일치해야 합니다.`
            );
        }
        if (!stateSecret) {
            log.error("[esi:config] ESI_STATE_SECRET 누락");
            throw new Error("ESI_STATE_SECRET이 필요합니다.");
        }
        return { clientId, clientSecret, redirectUri, stateSecret, scope };
    }

    // Dev: 친절한 실패 + .env 부트스트랩
    printEsiGuide();
    const suggestedRedirect = `http://localhost:${ESI_CALLBACK_PORT}/auth/eve/callback`;
    const toAdd = {};
    if (!clientId) toAdd.EVE_ESI_CLIENT_ID = "<EVE 개발자 포털에서 발급한 Client ID 입력>";
    if (!clientSecret)
        toAdd.EVE_ESI_CLIENT_SECRET = "<EVE 개발자 포털에서 Secret Key 복사 후 붙여넣기>";
    if (!redirectUri) toAdd.EVE_ESI_REDIRECT_URI = suggestedRedirect;
    if (!stateSecret) toAdd[STATE_SECRET_KEY] = crypto.randomBytes(32).toString("hex");

    if (Object.keys(toAdd).length > 0) {
        const envPath = resolveEnvPath();
        const added = appendMissingEnv(envPath, toAdd);
        if (added.length) {
            log.info("[esi:config] dev 부트스트랩: .env에 다음 키 추가됨 (기존 값 미덮어씀)", {
                added,
                envPath,
            });
        }
        throw new Error(
            `ESI 설정이 비어 있어 .env에 placeholder를 추가했습니다. 위 가이드대로 EVE_ESI_CLIENT_ID / EVE_ESI_CLIENT_SECRET을 채운 뒤 재시작하세요. 추가된 키: ${added.join(", ")}`
        );
    }

    return { clientId, clientSecret, redirectUri, stateSecret, scope };
}
