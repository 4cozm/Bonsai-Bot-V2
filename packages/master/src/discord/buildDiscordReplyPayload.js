// packages/master/src/discord/buildDiscordReplyPayload.js
export function buildDiscordReplyPayload(data) {
    if (data == null || typeof data !== "object") return { content: safeStringify(data) };
    if (typeof data.error === "string" && data.error.trim())
        return { content: `❌ ${data.error.trim()}` };
    if (data.embed !== true) {
        if (typeof data.message === "string" && data.message.trim())
            return { content: data.message };
        return { content: safeStringify(data) };
    }

    // 다중 임베드(페이지네이션): data.embeds 배열이 있으면 각 항목을 임베드로 빌드
    if (Array.isArray(data.embeds) && data.embeds.length > 0) {
        const embeds = data.embeds.slice(0, 10).map((spec) => buildOneEmbed(spec, data));
        return { content: "", embeds };
    }

    const title = typeof data.title === "string" && data.title.trim() ? data.title : "result";
    const description =
        typeof data.description === "string" && data.description.trim()
            ? data.description
            : undefined;

    const fields = normalizeFields(data.fields);
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

/**
 * @param {object} spec - { title?, description?, fields?, footer? }
 * @param {object} fallback - 공통 footer 등 폴백용
 */
function buildOneEmbed(spec, fallback) {
    const title =
        typeof spec.title === "string" && spec.title.trim()
            ? spec.title
            : typeof fallback?.title === "string" && fallback.title.trim()
              ? fallback.title
              : "result";
    const description =
        typeof spec.description === "string" && spec.description.trim()
            ? spec.description
            : undefined;
    const fields = normalizeFields(spec.fields);
    const footerText =
        typeof spec.footer === "string" && spec.footer.trim()
            ? spec.footer
            : typeof fallback?.footer === "string" && fallback.footer.trim()
              ? fallback.footer
              : "";
    return {
        title,
        description,
        fields: fields.length > 0 ? fields : [{ name: " ", value: " ", inline: false }],
        footer: footerText ? { text: footerText } : undefined,
        timestamp: new Date().toISOString(),
    };
}

const DISCORD_FIELD_VALUE_MAX = 1024;

function normalizeFields(fields) {
    if (!Array.isArray(fields)) return [];
    return fields
        .filter((f) => f && typeof f === "object")
        .map((f) => {
            const name = String(f.name ?? "").trim() || " ";
            let value = String(f.value ?? "").trim() || " ";
            if (value.length > DISCORD_FIELD_VALUE_MAX)
                value = value.slice(0, DISCORD_FIELD_VALUE_MAX - 1) + "…";
            return { name, value, inline: Boolean(f.inline) };
        })
        .filter((f) => f.name !== " " || f.value !== " ");
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
