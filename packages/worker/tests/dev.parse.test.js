// packages/worker/tests/dev.parse.test.js
import { describe, expect, test } from "@jest/globals";
import { parseDevArgs } from "../src/commands/dev.js";

describe("worker/commands/dev parseDevArgs()", () => {
    test("JSON 우선 파싱: {cmd,args}", () => {
        const out = parseDevArgs('{"cmd":"ping","args":""}');
        expect(out).toEqual({ cmd: "ping", args: "", ephemeral: true });
    });

    test("JSON 파싱 실패 시 fallback: raw string", () => {
        const out = parseDevArgs("ping hello");
        expect(out.cmd).toBe("ping");
        expect(typeof out.args).toBe("string");
        expect(out.ephemeral).toBe(true);
    });

    test("cmd 비어있으면 빈 cmd로 반환(혹은 throw) - 정책 고정 필요", () => {
        const out = parseDevArgs('{"cmd":"","args":"x"}');
        expect(out.cmd).toBe("");
        expect(out.ephemeral).toBe(true);
    });
});
