// packages/worker/src/commands/example.js
import { logger } from "@bonsai/shared";

const log = logger();

export default {
    // worker 디스패치 키 (envelope.cmd와 매칭)
    name: "example",

    // (선택) Discord 배포용 정의가 필요하면 넣고, 아니면 생략해도 됨
    discord: {
        name: "example",
        description: "예시 명령",
        type: 1,
        // options: [...]
    },

    /**
     * Worker에서 실행되는 명령 본체
     *
     * @param {object} ctx
     * @param {import("redis").RedisClientType} ctx.redis
     * @param {string} ctx.tenantKey
     * @param {ReturnType<import("@bonsai/shared").logger>} ctx.log
     * @param {Map<string, any>} ctx.commandMap
     * @param {object} [ctx.metrics] - ping 같은 일부 명령에서만 사용(표시 여부는 명령이 결정)
     *
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const t = String(ctx?.tenantKey ?? "");
        const envId = String(envelope?.id ?? "");
        const argsText = envelope?.args == null ? "" : String(envelope.args);

        log.info(`[cmd:example] 실행 tenant=${t} envelopeId=${envId} args=${argsText}`);

        // TODO: args 파싱 규칙은 명령 별로 결정
        // - 단순 문자열 args
        // - JSON 문자열 args

        return {
            ok: true,
            data: {
                message: "예시 결과",
                // embed: true 로 보내면 master가 embed로 렌더할 수 있다
                // embed: true,
                // title: "예시",
                // description: "내용",
                // fields: [{ name: "키", value: "값", inline: true }],
                // footer: `tenant=${t}`,
            },
        };
    },
};
