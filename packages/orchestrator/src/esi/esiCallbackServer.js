// packages/orchestrator/src/esi/esiCallbackServer.js
/**
 * EVE OAuth 콜백 HTTP 서버.
 * 호스팅: Global Orchestrator. 콜백 후 자동 완료를 위해 Worker에 esi-complete 명령을 발행한다.
 * 결과 메시지는 Worker → Master → 채널 브로드캐스트로 전달된다.
 */
import {
    buildCmdEnvelope,
    consumeNonce,
    logger,
    publishCmdToRedisStream,
    verifyState,
} from "@bonsai/shared";
import { getPrisma } from "@bonsai/shared/db";
import http from "node:http";
import { decodeEveJwtPayload } from "./decodeEveJwt.js";
import { exchangeEveCode } from "./exchangeEveCode.js";

const log = logger();

const NONCE_KEY_PREFIX = "bonsai:esi:nonce:";

/**
 * 콜백 핸들러: state 검증 → nonce 소비 → 토큰 교환 → JWT 디코딩 → DB 업데이트 → Worker에 esi-complete 발행.
 * 테넌트 DB는 state의 tenantKey로 getPrisma(tenantKey) 획득(중앙집중).
 *
 * @param {URL} url
 * @param {object} deps
 * @param {import("redis").RedisClientType} deps.redis
 * @returns {{ statusCode: number, body: string, headers?: Record<string,string> }}
 */
async function handleCallback(url, deps) {
    const { redis } = deps;
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
        return { statusCode: 400, body: "Missing code or state" };
    }

    // EVE_ESI_REDIRECT_URI는 EVE 개발자 포털에 등록한 콜백 URL과 완전 일치해야 함 (예: https://esi.cat4u.shop/auth/eve/callback). 불일치 시 EVE SSO 거부.
    const secret = String(process.env.ESI_STATE_SECRET ?? "").trim();
    const clientId = String(process.env.EVE_ESI_CLIENT_ID ?? "").trim();
    const clientSecret = String(process.env.EVE_ESI_CLIENT_SECRET ?? "").trim();
    const redirectUri = String(process.env.EVE_ESI_REDIRECT_URI ?? "").trim();

    if (!secret || !clientId || !clientSecret || !redirectUri) {
        log.error("[esi:callback] ESI 설정 누락");
        return { statusCode: 500, body: "Server configuration error" };
    }

    let payload;
    try {
        payload = verifyState(state, secret);
    } catch (err) {
        log.warn("[esi:callback] state 검증 실패", err?.message ?? err);
        return { statusCode: 400, body: "Invalid or expired state" };
    }

    const tenantKey = String(payload?.tenantKey ?? "").trim();
    if (!tenantKey) {
        log.warn("[esi:callback] state에 tenantKey 없음");
        return { statusCode: 400, body: "Invalid state (missing tenant)" };
    }

    const nonceKey = NONCE_KEY_PREFIX + payload.stateNonce;
    const consumed = await consumeNonce(redis, nonceKey);
    if (!consumed) {
        log.warn("[esi:callback] nonce 재사용 시도 stateNonce=" + payload.stateNonce);
        return { statusCode: 400, body: "State already used" };
    }

    const prisma = getPrisma(tenantKey);

    const tokenResult = await exchangeEveCode({
        code,
        redirectUri,
        clientId,
        clientSecret,
    });
    if (!tokenResult) {
        return { statusCode: 400, body: "Token exchange failed" };
    }

    const charInfo = decodeEveJwtPayload(tokenResult.access_token);
    if (!charInfo) {
        log.warn("[esi:callback] JWT 디코딩 실패");
        return { statusCode: 400, body: "Invalid token" };
    }

    const discordNickNorm = String(payload.discordNick ?? "")
        .trim()
        .toLowerCase();
    const charNameNorm = String(charInfo.characterName ?? "")
        .trim()
        .toLowerCase();
    const mainCandidate = discordNickNorm !== "" && discordNickNorm === charNameNorm;

    const reg = await prisma.esiRegistration.findUnique({
        where: { stateNonce: payload.stateNonce },
    });
    if (!reg) {
        log.warn("[esi:callback] EsiRegistration 없음 stateNonce=" + payload.stateNonce);
        return { statusCode: 400, body: "Registration not found" };
    }
    if (reg.status !== "PENDING") {
        return { statusCode: 400, body: "Already processed" };
    }

    const tokenExpiresAt = new Date(Date.now() + tokenResult.expires_in * 1000);
    await prisma.esiRegistration.update({
        where: { id: reg.id },
        data: {
            characterId: charInfo.characterId,
            characterName: charInfo.characterName,
            mainCandidate,
            accessToken: tokenResult.access_token,
            refreshToken: tokenResult.refresh_token ?? null,
            tokenExpiresAt,
        },
    });

    const channelId = String(reg.channelId ?? payload.channelId ?? "").trim();
    if (channelId) {
        try {
            const envelope = buildCmdEnvelope({
                tenantKey,
                cmd: "esi-complete",
                args: JSON.stringify({ registrationId: reg.id }),
                meta: {
                    discordUserId: reg.discordUserId,
                    guildId: String(reg.guildId ?? ""),
                    channelId,
                },
            });
            await publishCmdToRedisStream({ redis, envelope });
            log.info("[esi:callback] esi-complete 발행 완료 registrationId=" + reg.id);
        } catch (err) {
            log.error("[esi:callback] esi-complete 발행 실패", err);
        }
    } else {
        log.warn("[esi:callback] channelId 없어 esi-complete 미발행");
    }

    return {
        statusCode: 200,
        body: "EVE 연동이 완료되었습니다. Discord 채널에 결과를 보냈습니다.",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
    };
}

/**
 * HTTP 서버 시작. 경로: GET /auth/eve/callback?code=...&state=...
 * prisma는 콜백 시 state의 tenantKey로 getPrisma(tenantKey) 호출.
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {number} [params.port]
 * @returns {import("http").Server}
 */
export function startEsiCallbackServer({ redis, port = 0 }) {
    const p = Number(port) || 0;
    const server = http.createServer(async (req, res) => {
        const method = req.method ?? "";
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

        if (method !== "GET" || url.pathname !== "/auth/eve/callback") {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        try {
            const result = await handleCallback(url, { redis });
            res.writeHead(result.statusCode, result.headers ?? {});
            res.end(result.body);
        } catch (err) {
            log.error("[esi:callback] 처리 중 오류", err);
            res.writeHead(500);
            res.end("Internal Server Error");
        }
    });

    server.listen(p, () => {
        const addr = server.address();
        const portNum = typeof addr === "object" && addr?.port != null ? addr.port : p;
        log.info(`[esi:callback] HTTP 서버 리스닝 port=${portNum}`);
    });

    return server;
}
