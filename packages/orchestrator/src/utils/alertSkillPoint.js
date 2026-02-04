import { logger } from "@bonsai/shared";
import { postDiscordWebhook } from "./postDiscordWebhook.js";

const log = logger();

// 매주 화요일 DT 직후 무료 스킬포인트 알림
const SKILLPOINT_STICKER_ID = "1468569230336200836";

/**
 * 화요일이면 스킬포인트 알림을 별도 웹훅으로 전송한다.
 * - Discord가 sticker_ids를 거부할 수 있으므로 실패해도 content만 재시도한다.
 */
export async function alertSkillPointIfTuesday() {
    const now = new Date(Date.now());
    const day = now.getDay(); // 0=일, 2=화

    if (day !== 2) return;

    const url = String(process.env.DISCORD_ALERT_WEBHOOK_URL || "").trim();
    if (!url) {
        log.warn("[global:skill] DISCORD_ALERT_WEBHOOK_URL 미설정 - 스킬포인트 알림 생략");
        return;
    }

    const payloadWithSticker = {
        content: "화요일 DT 이후 무료 스킬포인트가 활성화됩니다.",
        sticker_ids: [SKILLPOINT_STICKER_ID],
    };

    try {
        await postDiscordWebhook({ url, payload: payloadWithSticker });
        log.info("[global:skill] 스킬포인트 알림(스티커 포함) 전송 완료");
    } catch (e) {
        log.warn(`[global:skill] 스티커 전송 실패 - 텍스트로 재시도 (${e?.message || e})`);
        await postDiscordWebhook({
            url,
            payload: { content: payloadWithSticker.content },
        });
        log.info("[global:skill] 스킬포인트 알림(텍스트) 전송 완료");
    }
}
