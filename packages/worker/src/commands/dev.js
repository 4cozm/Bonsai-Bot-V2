// packages/worker/src/commands/dev.js
import { logger } from "@bonsai/shared";

const log = logger();

/**
 * dev args 파싱
 * 1) JSON 우선: {"cmd":"ping","args":"..."}
 * 2) fallback: "ping ..." (첫 토큰 cmd, 나머지 args)
 *
 * @param {string} raw
 * @returns {{ innerCmd: string, innerArgs: string }}
 */
function parseDevArgs(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return { innerCmd: "", innerArgs: "" };

    // JSON 우선
    try {
        const j = JSON.parse(s);
        const innerCmd = String(j?.cmd ?? "").trim();
        const innerArgs = j?.args == null ? "" : String(j.args);
        if (innerCmd) return { innerCmd, innerArgs };
    } catch {
        // fallback으로 진행
    }

    // fallback: "cmd rest..."
    const [first, ...rest] = s.split(/\s+/);
    return { innerCmd: String(first ?? "").trim(), innerArgs: rest.join(" ") };
}

export default {
    name: "dev",
    discord: {
        name: "dev",
        description: "dev 전용 내부 명령 실행",
        type: 1,
        options: [
            {
                type: 3, // STRING
                name: "cmd",
                description: "실행할 내부 cmd (예: ping)",
                required: true,
            },
            {
                type: 3, // STRING
                name: "args",
                description: "내부 cmd args (옵션)",
                required: false,
            },
        ],
    },

    /**
     * dev 명령: 다른 명령을 실행한다.
     *
     * @param {object} ctx
     * @param {import("redis").RedisClientType} ctx.redis
     * @param {string} ctx.tenantKey
     * @param {Map<string, any>} ctx.commandMap
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const t = String(ctx?.tenantKey ?? "").trim();
        const envId = String(envelope?.id ?? "").trim();
        const rawArgs = envelope?.args;

        const { innerCmd, innerArgs } = parseDevArgs(rawArgs);

        if (!innerCmd) {
            return { ok: false, data: { error: "dev: inner cmd가 비어있음" } };
        }

        if (innerCmd === "dev") {
            return { ok: false, data: { error: "dev: dev 재귀 실행은 금지" } };
        }

        const map = ctx?.commandMap;
        const def = map?.get?.(innerCmd);

        if (!def) {
            return { ok: false, data: { error: `dev: unknown inner cmd: ${innerCmd}` } };
        }
        if (typeof def.execute !== "function") {
            return { ok: false, data: { error: `dev: handler missing: ${innerCmd}` } };
        }

        log.info(
            `[cmd:dev] forward tenant=${t} envId=${envId} innerCmd=${innerCmd} innerArgsLen=${
                String(innerArgs ?? "").length
            }`
        );

        const innerEnv = { ...envelope, cmd: innerCmd, args: innerArgs };
        return await def.execute(ctx, innerEnv);
    },
};
