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

    test("embed=true + embeds 배열이 있으면 다중 임베드로 반환", () => {
        const p = buildDiscordReplyPayload({
            embed: true,
            footer: "공통 푸터",
            embeds: [
                {
                    title: "페이지 1",
                    fields: [
                        { name: "품목", value: "A\nB", inline: true },
                        { name: "시세", value: "1\n2", inline: true },
                    ],
                },
                {
                    title: "페이지 2",
                    fields: [{ name: "품목", value: "C", inline: true }],
                },
            ],
        });
        expect(p.content).toBe("");
        expect(p.embeds).toHaveLength(2);
        expect(p.embeds[0].title).toBe("페이지 1");
        expect(p.embeds[0].fields).toHaveLength(2);
        expect(p.embeds[0].footer).toEqual({ text: "공통 푸터" });
        expect(p.embeds[1].title).toBe("페이지 2");
        expect(p.embeds[1].fields).toHaveLength(1);
    });
});
