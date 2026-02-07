// packages/worker/tests/redisStreamsCommandConsumer.contract.test.js
// 아키텍처 계약: cmd 없음 / unknown cmd 시 result envelope 형식 검증 (consumer 내부 로직 대신 계약만 테스트)
import { describe, expect, test } from "@jest/globals";
import { buildResultEnvelope } from "@bonsai/shared";
import { getCommandMap } from "../src/commands/index.js";

describe("worker/redisStreamsCommandConsumer 계약 (에러 반환 형식)", () => {
    test("cmd 비어있음 → ok:false, data.error === 'cmd가 비어있음'", () => {
        const execData = { error: "cmd가 비어있음" };
        const env = buildResultEnvelope({
            inReplyTo: "cmd-1",
            ok: false,
            data: execData,
            meta: { tenantKey: "CAT", cmd: "" },
        });
        expect(env.type).toBe("result");
        expect(env.ok).toBe(false);
        expect(env.data).toEqual({ error: "cmd가 비어있음" });
    });

    test("unknown cmd → ok:false, data.error === 'unknown cmd: <cmdName>'", () => {
        const cmdName = "nonexistent-command";
        const execData = { error: `unknown cmd: ${cmdName}` };
        const env = buildResultEnvelope({
            inReplyTo: "cmd-2",
            ok: false,
            data: execData,
            meta: { tenantKey: "FISH", cmd: cmdName },
        });
        expect(env.ok).toBe(false);
        expect(env.data.error).toBe("unknown cmd: nonexistent-command");
    });

    test("commandMap에 없는 이름은 get으로 undefined", () => {
        const map = getCommandMap();
        expect(map.get("__nonexistent__")).toBeUndefined();
        expect(map.get("시세")).toBeDefined();
    });
});
