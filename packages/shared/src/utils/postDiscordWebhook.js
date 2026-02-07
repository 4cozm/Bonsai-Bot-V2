import { logger } from "./logger.js";

const log = logger();

/**
 * Discord Webhook로 메시지 전송.
 * @param {{ url: string, payload: object }} params
 */
export async function postDiscordWebhook({ url, payload }) {
    const target = String(url ?? "").trim();
    if (!target) {
        throw new Error("webhook url이 비어있습니다");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const res = await fetch(target, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload ?? {}),
            signal: controller.signal,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            log.error(`[webhook] 전송 실패 status=${res.status} ${res.statusText} body=${text}`);
            throw new Error(`Webhook 전송 실패: ${res.status} ${res.statusText}`);
        }
    } finally {
        clearTimeout(timeout);
    }
}
