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

        // ping 자체는 거의 아무 것도 안 하므로 handler는 "측정 구간"만 확보
        const handlerNsStart = process.hrtime.bigint();
        const handlerNsEnd = process.hrtime.bigint();
        const handlerMs = Number(handlerNsEnd - handlerNsStart) / 1_000_000;

        const discordToWorkerReceiveMs =
            issuedAtMs == null ? null : Math.max(0, receivedAtMs - issuedAtMs);
        const workerTotalMs = Math.max(0, finishedAtMs - receivedAtMs);

        const metrics = {
            issuedAtMs,
            workerReceivedAtMs: receivedAtMs,
            workerFinishedAtMs: finishedAtMs,
            discordToWorkerReceiveMs,
            workerHandlerMs: handlerMs,
            workerTotalMs,
        };

        // ✅ 한글 요약(사람이 읽는 값)
        const summaryLines = [
            `- Discord → Worker 수신 지연: ${formatMsK(discordToWorkerReceiveMs)}`,
            `- Worker 총 처리 시간: ${formatMsK(workerTotalMs)}`,
            `- Handler 실행 시간: ${formatMsK(handlerMs)}`,
        ];

        // (선택) 원시 epoch는 “접어서” 보이도록 별도 라인으로 분리
        const rawLines = [
            `issuedAtMs=${issuedAtMs ?? "null"}`,
            `receivedAtMs=${receivedAtMs}`,
            `finishedAtMs=${finishedAtMs}`,
        ];

        return {
            ok: true,
            data: {
                embed: true,
                title: "퐁 (ping)",
                description: summaryLines.join("\n"),
                // master가 fields로 만들기 쉬운 구조도 같이 준다
                fields: [
                    {
                        name: "Discord → Worker",
                        value: formatMsK(discordToWorkerReceiveMs),
                        inline: true,
                    },
                    { name: "Worker 총 처리", value: formatMsK(workerTotalMs), inline: true },
                    { name: "Handler", value: formatMsK(handlerMs), inline: true },
                ],
                footer: `tenant=${t} envelopeId=${envId}`,
                // 디버깅/추후 매트릭용 원시값은 그대로 보관
                metrics,
                raw: rawLines.join(" | "),
            },
        };
    },
};

/**
 * ms 값을 한국어 표기로 보기 좋게 만든다.
 * - 1ms 미만이면 µs로 보여준다.
 * @param {number|null} ms
 * @returns {string}
 */
function formatMsK(ms) {
    if (ms == null) return "알 수 없음";
    const n = Number(ms);
    if (!Number.isFinite(n)) return "알 수 없음";

    // 0.001ms = 1µs
    if (n > 0 && n < 1) {
        const us = n * 1000;
        return `${us.toFixed(1)} µs`;
    }
    return `${n.toFixed(0)} ms`;
}
