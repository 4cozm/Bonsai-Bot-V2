// packages/api/src/server.js
// 프론트(bonsai-supply)가 붙을 REST API. listen()은 index.js에서 하고, 여기는
// app 조립만 담당 — 테스트에서 실제 포트를 열지 않고 바로 요청을 만들 수 있게 한다.

import express from "express";
import { createAuthRouter } from "./routes/auth.js";

/**
 * Express app을 만든다.
 * @param {{ redis: import("redis").RedisClientType, log: {info:Function, warn:Function, error:Function} }} deps
 * @returns {import("express").Express}
 */
export function createApp({ redis, log }) {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json());

    app.get("/health", (req, res) => {
        res.json({ ok: true, service: "bonsai-api" });
    });

    app.use("/auth", createAuthRouter({ redis, log }));

    return app;
}
