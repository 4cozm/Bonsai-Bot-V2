// packages/api/src/routes/auth.js
import express from "express";
import { consumeMagicLinkToken, signSessionJwt } from "@bonsai/shared";

export const SESSION_COOKIE_NAME = "bonsai_session";
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7일

/**
 * /auth 라우터. /보급 명령이 발급한 매직링크를 소비해서 세션 쿠키를 발급한다.
 * @param {{ redis: import("redis").RedisClientType, log: {info:Function, warn:Function} }} deps
 * @returns {import("express").Router}
 */
export function createAuthRouter({ redis, log }) {
    const router = express.Router();

    router.get("/consume", async (req, res) => {
        // frontendUrl은 실패 케이스에서도 "안내 페이지로 리다이렉트"에 필요해서
        // token 검사보다 먼저 확보한다 — 이게 없으면 안전하게 보낼 곳이 없어
        // 그때만 예외적으로 JSON 500을 그대로 준다(진짜 설정 오류라 유저 액션으로
        // 해결이 안 됨).
        const frontendUrl = String(process.env.STOCK_FRONTEND_URL ?? "").trim();
        const secret = String(process.env.STOCK_SESSION_JWT_SECRET ?? "").trim();
        if (!secret || !frontendUrl) {
            log.warn("[auth] STOCK_SESSION_JWT_SECRET 또는 STOCK_FRONTEND_URL 미설정");
            return res.status(500).json({ ok: false, error: "시스템 설정 오류" });
        }

        const token = String(req.query?.token ?? "").trim();
        if (!token) {
            return res.redirect(302, `${frontendUrl}?authError=missing_token`);
        }

        const payload = await consumeMagicLinkToken(redis, token);
        if (!payload?.discordId || !payload?.tenantKey) {
            log.warn("[auth] 매직링크 소비 실패(만료/이미 사용/유효하지 않음)");
            return res.redirect(302, `${frontendUrl}?authError=expired_link`);
        }

        const sessionToken = signSessionJwt(
            { discordId: payload.discordId, tenantKey: payload.tenantKey },
            secret,
            SESSION_TTL_SEC
        );

        res.cookie(SESSION_COOKIE_NAME, sessionToken, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            maxAge: SESSION_TTL_SEC * 1000,
            path: "/",
        });

        log.info("[auth] 로그인 성공", {
            discordId: payload.discordId,
            tenantKey: payload.tenantKey,
        });

        res.redirect(302, frontendUrl);
    });

    return router;
}
