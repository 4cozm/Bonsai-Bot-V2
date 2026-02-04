/**
 * DT 오픈 알림을 단일 웹훅으로 1회만 전송한다.
 *
 * args(JSON 문자열) 예:
 *  {
 *    "eventId": "eve:dt-open:2026-02-04",
 *    "message": "✅ EVE 서버 오픈!"
 *  }
 */

function mustWebhookUrl() {
    const url = String(process.env.DISCORD_DT_WEBHOOK_URL || "").trim();
    if (!url) throw new Error("DISCORD_DT_WEBHOOK_URL 미설정");
    return url;
}

function parseArgs(text) {
    const s = String(text ?? "").trim();
    if (!s) return {};
    try {
        return JSON.parse(s);
    } catch {
        // args가 단순 문자열인 경우를 허용
        return { message: s };
    }
}

async function setDedup({ redis, key, ttlSec }) {
    // Redis SET NX EX
    const res = await redis.set(key, "1", { NX: true, EX: ttlSec });
    return res === "OK";
}

async function postWebhook(url, content) {
    const payload = {
        content: String(content ?? ""),
        allowed_mentions: { parse: [] },
    };

    const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`webhook 전송 실패 status=${r.status} body=${t.slice(0, 200)}`);
    }
}

export const cmdDtNotify = {
    /**
     * @param {object} ctx
     * @param {import("redis").RedisClientType} ctx.redis
     * @param {{info:Function,warn:Function,error:Function}} ctx.log
     * @param {object} envelope
     */
    async execute(ctx, envelope) {
        const { redis, log } = ctx;

        const args = parseArgs(envelope?.args);
        const eventId =
            String(args.eventId || "").trim() || `dt-open:${new Date().toISOString().slice(0, 10)}`;
        const message = String(args.message || "✅ EVE 서버 오픈!").trim();

        const webhookUrl = mustWebhookUrl();

        const dedupKey = `bonsai:dedup:webhook:${hashKey(webhookUrl)}:${eventId}`;
        const ttlSec = 60 * 60 * 6; // 6시간이면 DT 중복 제거로 충분

        const acquired = await setDedup({ redis, key: dedupKey, ttlSec });
        if (!acquired) {
            log.info(`[global:dt.notify] 중복 감지 - 전송 스킵 eventId=${eventId}`);
            return { ok: true, data: { skipped: true, eventId } };
        }

        await postWebhook(webhookUrl, message);
        log.info(`[global:dt.notify] 전송 완료 eventId=${eventId}`);

        return { ok: true, data: { skipped: false, eventId } };
    },
};

function hashKey(s) {
    // crypto 없이도 충분한 짧은 해시 (키 길이 제한 회피)
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}
