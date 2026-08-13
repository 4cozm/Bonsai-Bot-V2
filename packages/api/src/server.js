// packages/api/src/server.js
// 프론트(bonsai-supply)가 붙을 REST API. listen()은 index.js에서 하고, 여기는
// app 조립만 담당 — 테스트에서 실제 포트를 열지 않고 바로 요청을 만들 수 있게 한다.

import cors from "cors";
import express from "express";
import { createAuthRouter } from "./routes/auth.js";
import { createStockRouter } from "./routes/stock.js";

/**
 * Express app을 만든다.
 * @param {{ redis: import("redis").RedisClientType, log: {info:Function, warn:Function, error:Function} }} deps
 * @returns {import("express").Express}
 */
export function createApp({ redis, log }) {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json());

    // /auth/consume은 풀페이지 리다이렉트라 CORS 대상이 아니지만, 프론트가
    // fetch()로 붙는 /v1/stock/* 는 크로스오리진 + 쿠키 포함 요청이라 명시적
    // origin(와일드카드 불가) + credentials:true 가 필요하다.
    const frontendUrl = String(process.env.STOCK_FRONTEND_URL ?? "").trim();
    if (frontendUrl) {
        app.use(cors({ origin: frontendUrl, credentials: true }));
    }

    app.get("/health", (req, res) => {
        res.json({ ok: true, service: "bonsai-api" });
    });

    app.use("/auth", createAuthRouter({ redis, log }));
    app.use("/v1/stock", createStockRouter());

    return app;
}
