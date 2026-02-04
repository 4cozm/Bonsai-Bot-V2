import { logger } from "@bonsai/shared";
import { alertSkillPointIfTuesday } from "../utils/alertSkillPoint.js";
import { getServerStatus } from "../utils/getServerStatus.js";
import { postDiscordWebhook } from "../utils/postDiscordWebhook.js";

const log = logger();

function toLocalDateKey(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function toNumberOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function shouldUpdateVersion(current, next) {
    const a = toNumberOrNull(current);
    const b = toNumberOrNull(next);
    if (a != null && b != null) return b > a;
    return String(next || "") !== String(current || "");
}

function scheduleDailyAt({ hour, minute, signal, fn }) {
    let timer = null;

    const arm = () => {
        if (signal?.aborted) return;

        const now = new Date(Date.now());
        const next = new Date(now);
        next.setHours(hour, minute, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);

        const delay = Math.max(1_000, next.getTime() - now.getTime());
        timer = setTimeout(async () => {
            try {
                await fn();
            } finally {
                arm();
            }
        }, delay);
    };

    arm();

    if (signal) {
        signal.addEventListener(
            "abort",
            () => {
                if (timer) clearTimeout(timer);
            },
            { once: true }
        );
    }
}

/**
 * 글로벌 DT(다운타임) 오픈 감지 + 웹훅 알림 스케줄러.
 * - 오케스트레이터가 켜지면 자동으로 동작한다.
 * - 목적지가 '공용 EVE-Status 채널(웹훅 1개)' 이므로 tenant 단위 dedup을 하지 않는다.
 * - 프로세스 재시작/중복 실행을 고려해 Redis에 dedup 키를 남긴다.
 */
export async function startDtScheduler({ redis, signal }) {
    const dtWebhookUrl = String(process.env.DISCORD_DT_WEBHOOK_URL || "").trim();
    if (!dtWebhookUrl) {
        log.warn("[global:dt] DISCORD_DT_WEBHOOK_URL 미설정 - DT 스케줄러 비활성화");
        return;
    }

    // 부팅 시 서버 버전 1회 캐싱 (메모리 + Redis)
    let baselineVersion = null;
    try {
        const stat = await getServerStatus();
        baselineVersion = stat?.server_version ?? null;
        if (baselineVersion != null) {
            await redis.set("bonsai:cache:esi:server_version", String(baselineVersion), {
                EX: 60 * 60 * 24 * 7,
            });
        }
        log.info(`[global:dt] 부팅 초기 서버 버전=${baselineVersion ?? "(없음)"}`);
    } catch (e) {
        log.warn(`[global:dt] 부팅 시 서버 버전 조회 실패 (${e?.message || e})`);
    }

    const hour = Number(process.env.DT_CHECK_HOUR ?? 11);
    const minute = Number(process.env.DT_CHECK_MINUTE ?? 0);
    const pollMs = Number(process.env.DT_POLL_MS ?? 30_000);

    log.info(`[global:dt] DT 스케줄 등록 완료 (매일 ${hour}:${String(minute).padStart(2, "0")})`);

    scheduleDailyAt({
        hour,
        minute,
        signal,
        fn: async () => {
            if (signal?.aborted) return;

            log.info("[global:dt] DT 체크 시작");
            const todayKey = toLocalDateKey(new Date(Date.now()));

            // VIP 알림/오픈 알림을 날짜 단위로 멱등 처리
            const vipDedupKey = `bonsai:dedup:dt:${todayKey}:vip`;
            const openDedupKey = `bonsai:dedup:dt:${todayKey}:open`;
            const lockTtlSec = 60 * 60 * 12;

            const interval = setInterval(async () => {
                if (signal?.aborted) {
                    clearInterval(interval);
                    return;
                }

                try {
                    const serverStatus = await getServerStatus();
                    const startTime = new Date(serverStatus.start_time);
                    const currentTime = new Date(Date.now());

                    // "오늘 DT인지" 확인: start_time 날짜가 오늘과 같을 때만 처리
                    if (toLocalDateKey(startTime) !== toLocalDateKey(currentTime)) return;

                    const vipStatus = serverStatus.vip ?? false;

                    if (vipStatus === true) {
                        const ok = await redis.set(vipDedupKey, "1", {
                            NX: true,
                            EX: lockTtlSec,
                        });

                        if (ok) {
                            let content = "서버 반쯤 오픈, 현재는 CCP 개발자만 접근 가능";

                            if (shouldUpdateVersion(baselineVersion, serverStatus.server_version)) {
                                content += " (버전이 업데이트됨 - VPN 유저 주의)";
                                baselineVersion = serverStatus.server_version;
                                await redis.set(
                                    "bonsai:cache:esi:server_version",
                                    String(baselineVersion),
                                    { EX: 60 * 60 * 24 * 7 }
                                );
                            }

                            await postDiscordWebhook({
                                url: dtWebhookUrl,
                                payload: { content },
                            });

                            log.info("[global:dt] VIP 오픈 알림 전송");
                        }

                        return;
                    }

                    // vip=false => 일반 유저 접속 가능
                    const ok = await redis.set(openDedupKey, "1", {
                        NX: true,
                        EX: lockTtlSec,
                    });

                    if (!ok) {
                        // 이미 보낸 경우
                        clearInterval(interval);
                        return;
                    }

                    let content = "서버 접속가능";
                    if (baselineVersion == null) {
                        content = `서버 접속가능, 서버 버전을 확인할 수 없습니다. ${serverStatus.server_version} 버전을 최신으로 설정했습니다.`;
                        baselineVersion = serverStatus.server_version;
                    } else if (shouldUpdateVersion(baselineVersion, serverStatus.server_version)) {
                        content =
                            "서버 접속가능, 버전이 업데이트되었습니다. VPN 유저는 주의해주세요";
                        baselineVersion = serverStatus.server_version;
                    }

                    if (baselineVersion != null) {
                        await redis.set(
                            "bonsai:cache:esi:server_version",
                            String(baselineVersion),
                            { EX: 60 * 60 * 24 * 7 }
                        );
                    }

                    await postDiscordWebhook({
                        url: dtWebhookUrl,
                        payload: { content },
                    });
                    log.info("[global:dt] 서버 오픈 알림 전송");

                    // 화요일은 무료 스킬포인트 알림 (별도 웹훅)
                    await alertSkillPointIfTuesday();

                    clearInterval(interval);
                } catch (e) {
                    log.error(`[global:dt] DT 체크 중 오류 (${e?.message || e})`);
                }
            }, pollMs);

            if (signal) {
                signal.addEventListener(
                    "abort",
                    () => {
                        clearInterval(interval);
                    },
                    { once: true }
                );
            }
        },
    });
}
