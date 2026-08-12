// packages/api/src/index.js
import { createApp } from "./server.js";
import { initializeApi } from "./initialize.js";

/**
 * API 서버를 지정한 포트에서 기동한다.
 * @param {{ port: number, redis: import("redis").RedisClientType, log: {info:Function, warn:Function, error:Function} }} params
 * @returns {import("node:http").Server}
 */
export function startApiServer({ port, redis, log }) {
    const app = createApp({ redis, log });
    const server = app.listen(port, () => {
        log.info(`[api] 서버 기동 완료 port=${port}`);
    });
    return server;
}

export { createApp, initializeApi };
