import Transport from "winston-transport";

function safeString(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

function buildDiscordContent(info) {
    const ts = info.timestamp || new Date().toISOString();
    const msg = info.message || "";
    const meta = info.meta;

    let extra = "";
    if (meta instanceof Error) {
        extra = meta.stack || meta.message || "";
    } else if (meta && typeof meta === "object") {
        extra = safeString(meta);
    } else if (meta) {
        extra = String(meta);
    }

    const base = `[WARN] ${ts}\n${msg}`;
    const merged = extra ? `${base}\n\n${extra}` : base;

    return merged.length > 1900 ? `${merged.slice(0, 1900)}\n...(생략)` : merged;
}

export default class DiscordWarnWebhookTransport extends Transport {
    constructor(opts = {}) {
        super(opts);
        this.webhookUrl = (opts.webhookUrl || "").trim();
        this.serviceName = (opts.serviceName || "app").trim();
        this.enabled = Boolean(this.webhookUrl);
    }

    log(info, callback) {
        setImmediate(() => this.emit("logged", info));
        callback();

        if (!this.enabled) return;

        if (info.level !== "warn") return;

        const content = buildDiscordContent(info);
        const payload = {
            content: `**[${this.serviceName}]**\n${content}`,
            allowed_mentions: { parse: [] },
        };

        fetch(this.webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        }).catch((e) => {
            process.stderr.write(`[logger] Discord 웹훅 전송 실패: ${e?.message ?? e}\n`);
        });
    }
}
