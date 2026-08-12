// packages/api/src/index.js
import { createApp } from "./server.js";

/**
 * API 서버를 지정한 포트에서 기동한다.
 * @param {{ port: number, log: {info:Function, warn:Function, error:Function} }} params
 * @returns {import("node:http").Server}
 */
export function startApiServer({ port, log }) {
    const app = createApp();
    const server = app.listen(port, () => {
        log.info(`[api] 서버 기동 완료 port=${port}`);
    });
    return server;
}

export { createApp };
