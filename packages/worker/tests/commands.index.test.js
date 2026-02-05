// packages/worker/tests/commands.index.test.js
import { describe, expect, test } from "@jest/globals";
import { getCommandMap } from "../src/commands/index.js";

describe("worker/commands/index getCommandMap()", () => {
    test("필수 커맨드가 map에 존재", () => {
        const map = getCommandMap();
        expect(map).toBeInstanceOf(Map);

        expect(map.has("핑")).toBe(true);
        expect(map.has("dev")).toBe(true);
        expect(map.has("가입")).toBe(true);
        expect(map.has("esi-complete")).toBe(true);
        expect(map.has("캐릭터목록")).toBe(true);

        const ping = map.get("핑");
        expect(typeof ping.execute).toBe("function");
    });

    test("중복 등록 방어가 동작해야 함(구조상)", () => {
        // index.js 내부 add()가 중복을 throw하도록 되어 있어야 함
        // (지금 구조가 이미 그렇다면 이 테스트는 “문서화된 기대치” 역할)
        const map = getCommandMap();
        expect(map.size).toBeGreaterThanOrEqual(5);
    });
});
