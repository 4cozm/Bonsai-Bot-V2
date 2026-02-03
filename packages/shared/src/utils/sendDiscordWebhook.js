/**
 * Discord Webhook content는 2000자 제한이 있어서 안전하게 잘라낸다.
 * @param {unknown} content
 * @returns {string}
 */
function clip(content) {
    const s = String(content ?? "");
    if (s.length <= 1900) return s;
    return `${s.slice(0, 1900)}\n...(생략)`;
}

/**
 * DISCORD_WARN_WEBHOOK_URL로 간단 메시지를 전송한다.
 * - 로거와 같은 웹훅을 사용한다.
 * - 웹훅이 없거나 전송 실패 시 조용히 무시한다.
 *
 * @param {unknown} message 전송할 메시지(문자열/에러/객체 등). String()으로 변환된다.
 * @returns {Promise<void>}
 */
export async function sendDiscordWebhook(message) {
    const url = (process.env.DISCORD_WARN_WEBHOOK_URL || "").trim();
    if (!url) return;

    const payload = {
        content: clip(message),
        allowed_mentions: { parse: [] },
    };

    try {
        await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
    } catch {
        // 실패는 조용히 무시 (간단 용도)
    }
}
