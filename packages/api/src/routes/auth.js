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
        const token = String(req.query?.token ?? "").trim();
        if (!token) {
            return res.status(400).json({ ok: false, error: "token이 없습니다." });
        }

        const payload = await consumeMagicLinkToken(redis, token);
        if (!payload?.discordId || !payload?.tenantKey) {
            log.warn("[auth] 매직링크 소비 실패(만료/이미 사용/유효하지 않음)");
            return res
                .status(400)
                .json({ ok: false, error: "링크가 만료됐거나 이미 사용된 링크입니다." });
        }

        const secret = String(process.env.STOCK_SESSION_JWT_SECRET ?? "").trim();
        const frontendUrl = String(process.env.STOCK_FRONTEND_URL ?? "").trim();
        if (!secret || !frontendUrl) {
            log.warn("[auth] STOCK_SESSION_JWT_SECRET 또는 STOCK_FRONTEND_URL 미설정");
            return res.status(500).json({ ok: false, error: "시스템 설정 오류" });
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
