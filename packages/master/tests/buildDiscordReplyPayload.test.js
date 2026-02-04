// packages/master/tests/buildDiscordReplyPayload.test.js
import { describe, expect, test } from "@jest/globals";
import { buildDiscordReplyPayload } from "../src/discord/buildDiscordReplyPayload.js";

describe("master/buildDiscordReplyPayload", () => {
    test("embed=false면 content 반환", () => {
        const p = buildDiscordReplyPayload({ message: "안녕" });
        expect(p).toEqual({ content: "안녕" });
    });

    test("embed=true + 필드 있으면 embed로", () => {
        const p = buildDiscordReplyPayload({
            embed: true,
            title: "퐁",
            description: "요약",
            fields: [{ name: "A", value: "1", inline: true }],
            footer: "footer",
        });

        expect(p.content).toBe(""); // 기존 텍스트 제거
        expect(Array.isArray(p.embeds)).toBe(true);
        expect(p.embeds[0]).toEqual(
            expect.objectContaining({
                title: "퐁",
                description: "요약",
                fields: [expect.objectContaining({ name: "A", value: "1", inline: true })],
                footer: { text: "footer" },
            })
        );
    });

    test("embed=true인데 fields 없으면 fallback fields 생성", () => {
        const p = buildDiscordReplyPayload({ embed: true, title: "x" });
        expect(p.content).toBe("");
        expect(p.embeds[0].fields.length).toBeGreaterThan(0);
    });
});
