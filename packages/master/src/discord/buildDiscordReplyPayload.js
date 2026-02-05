// packages/master/src/discord/buildDiscordReplyPayload.js
export function buildDiscordReplyPayload(data) {
    if (data == null || typeof data !== "object") return { content: safeStringify(data) };
    if (data.embed !== true) {
        if (typeof data.message === "string" && data.message.trim())
            return { content: data.message };
        return { content: safeStringify(data) };
    }

    const title = typeof data.title === "string" && data.title.trim() ? data.title : "result";
    const description =
        typeof data.description === "string" && data.description.trim()
            ? data.description
            : undefined;

    const fields = Array.isArray(data.fields)
        ? data.fields
              .filter((f) => f && typeof f === "object")
              .map((f) => ({
                  name: String(f.name ?? "").trim() || " ",
                  value: String(f.value ?? "").trim() || " ",
                  inline: Boolean(f.inline),
              }))
              .filter((f) => f.name !== " " || f.value !== " ")
        : [];

    const footerText =
        typeof data.footer === "string" && data.footer.trim()
            ? data.footer
            : typeof data.raw === "string" && data.raw.trim()
              ? data.raw
              : "";

    const embed = {
        title,
        description,
        fields:
            fields.length > 0
                ? fields
                : description
                  ? []
                  : [{ name: "data", value: safeStringify(data), inline: false }],
        footer: footerText ? { text: footerText } : undefined,
        timestamp: new Date().toISOString(),
    };

    return { content: "", embeds: [embed] };
}

function safeStringify(v) {
    try {
        if (v == null) return "(no data)";
        const s = JSON.stringify(v);
        return s.length > 1800 ? `${s.slice(0, 1800)}…` : s;
    } catch {
        return String(v);
    }
}
