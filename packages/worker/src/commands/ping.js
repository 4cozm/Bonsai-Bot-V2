// packages/worker/src/commands/ping.js
import { logger } from "@bonsai/shared";
const log = logger();

export default {
    name: "ping",
    discord: {
        name: "ping",
        description: "워커 상태 확인",
        type: 1,
    },
    async execute(ctx, envelope) {
        log.info(`[cmd:ping] 처리 tenant=${envelope.tenantKey}`);
        return { ok: true, data: "퐁~" };
    },
};
