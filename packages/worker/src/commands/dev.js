// packages/worker/src/commands/dev.js
import { logger } from "@bonsai/shared";

const log = logger();

/**
 * dev 커맨드 args 파싱
 * - 1순위: JSON({cmd,args})
 * - 2순위: raw string ("ping ..." 형태)
 *
 * @param {string} raw
 * @returns {{cmd:string, args:string}}
 */
export function parseDevArgs(raw) {
    const text = raw == null ? "" : String(raw).trim();

    // 1) JSON 우선
    if (text.startsWith("{") && text.endsWith("}")) {
        try {
            const obj = JSON.parse(text);
            const cmd = obj?.cmd == null ? "" : String(obj.cmd);
            const args = obj?.args == null ? "" : String(obj.args);
            return { cmd, args };
        } catch {
            // fallthrough
        }
    }

    // 2) fallback: 첫 토큰=cmd, 나머지=args
    if (!text) return { cmd: "", args: "" };

    const [first, ...rest] = text.split(/\s+/);
    const cmd = first == null ? "" : String(first);
    const args = rest.length > 0 ? rest.join(" ") : "";
    return { cmd, args };
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

        const { cmd, args } = parseDevArgs(envelope.args);

        if (!cmd) {
            return { ok: false, data: { error: "dev: inner cmd가 비어있음" } };
        }

        if (cmd === "dev") {
            return { ok: false, data: { error: "dev: dev 재귀 실행은 금지" } };
        }

        const map = ctx?.commandMap;
        const def = map?.get?.(cmd);

        if (!def) {
            return { ok: false, data: { error: `dev: unknown inner cmd: ${cmd}` } };
        }
        if (typeof def.execute !== "function") {
            return { ok: false, data: { error: `dev: handler missing: ${cmd}` } };
        }

        log.info(
            `[cmd:dev] forward tenant=${t} envId=${envId} cmd=${cmd} argsLen=${
                String(args ?? "").length
            }`
        );

        const innerEnv = { ...envelope, cmd: cmd, args: args };
        return await def.execute(ctx, innerEnv);
    },
};
