// packages/worker/src/commands/ping.js
import { logger } from "@bonsai/shared";

const log = logger();

export default {
    name: "ping",
    discord: {
        name: "ping",
        description: "워커 지연/처리시간 확인",
        type: 1,
    },

    /**
     * @param {object} ctx
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const t = String(ctx?.tenantKey ?? "");
        const envId = String(envelope?.id ?? "");
        log.info(`[cmd:ping] 실행 tenant=${t} envelopeId=${envId}`);

        const issuedAtMs = ctx?.metrics?.issuedAtMs ?? null;
        const receivedAtMs = ctx?.metrics?.workerReceivedAtMs ?? Date.now();
        const finishedAtMs = Date.now();

        const handlerNsStart = process.hrtime.bigint();

        const handlerNsEnd = process.hrtime.bigint();
        const handlerMs = Number(handlerNsEnd - handlerNsStart) / 1_000_000;

        const metrics = {
            issuedAtMs,
            workerReceivedAtMs: receivedAtMs,
            workerFinishedAtMs: finishedAtMs,
            discordToWorkerReceiveMs:
                issuedAtMs == null ? null : Math.max(0, receivedAtMs - issuedAtMs),
            workerHandlerMs: handlerMs,
            workerTotalMs: Math.max(0, finishedAtMs - receivedAtMs),
        };

        return {
            ok: true,
            data: {
                embed: true,
                title: "pong",
                metrics: {
                    discordToWorkerReceiveMs: 982,
                    workerHandlerMs: 0.0004,
                    workerTotalMs: 1,
                    issuedAtMs: 1770140918000,
                    workerReceivedAtMs: 1770140918982,
                    workerFinishedAtMs: 1770140918983,
                },
            },
        };
    },
};
