// packages/orchestrator/src/schedulers/pajamaHotScheduler.js
// 매일 KST 05:00 (UTC 20:00) 잠옷 핫유저 분류 커맨드를 각 테넌트 워커에 발행.

import { buildCmdEnvelope, logger, publishCmdToRedisStream } from "@bonsai/shared";

const log = logger();

function scheduleDailyAt({ hour, minute, signal, fn }) {
    let timer = null;

    const arm = () => {
        if (signal?.aborted) return;

        const now = new Date(Date.now());
        const next = new Date(now);
        next.setUTCHours(hour, minute, 0, 0);
        if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

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
 * DISCORD_TENANT_MAP (channelId:tenantKey,...) 파싱하여 tenantKey 목록 반환.
 * @returns {string[]}
 */
function getTenantKeys() {
    const raw = String(process.env.DISCORD_TENANT_MAP ?? "").trim();
    if (!raw) return [];

    return raw
        .split(",")
        .map((chunk) => {
            const idx = chunk.trim().indexOf(":");
            return idx > 0 ? chunk.trim().slice(idx + 1).trim() : null;
        })
        .filter(Boolean);
}

/**
 * 전 테넌트에 "잠옷-핫유저-분류" 커맨드를 1회 발행.
 */
async function publishToAllTenants({ redis, tenantKeys, signal }) {
    if (signal?.aborted) return;

    for (const tenantKey of tenantKeys) {
        try {
            const envelope = buildCmdEnvelope({
                tenantKey,
                cmd: "잠옷-핫유저-분류",
                args: "",
                meta: { issuedAt: Math.floor(Date.now() / 1000) },
            });
            await publishCmdToRedisStream({ redis, envelope });
            log.info(`[global:pajama] 발행 tenant=${tenantKey}`);
        } catch (err) {
            log.warn(`[global:pajama] 발행 실패 tenant=${tenantKey}`, {
                message: err?.message,
            });
        }
    }
}

/**
 * 시작 시 즉시 1회 발행 후, 매일 KST 05:00 (UTC 20:00) 반복 발행.
 */
export async function startPajamaHotScheduler({ redis, signal }) {
    const tenantKeys = getTenantKeys();
    if (tenantKeys.length === 0) {
        log.info("[global:pajama] DISCORD_TENANT_MAP 비어있음 - 잠옷 핫유저 스케줄러 비활성화");
        return;
    }

    // KST 05:00 = UTC 20:00
    const hour = 20;
    const minute = 0;

    log.info(
        `[global:pajama] 잠옷 핫유저 분류 스케줄 등록 (시작 시 즉시 1회 + 매일 UTC ${hour}:${String(minute).padStart(2, "0")} / KST 05:00) tenants=${tenantKeys.length}`
    );

    // 시작 시 즉시 1회 발행 (워커 부팅 직후 hot 목록 초기화)
    await publishToAllTenants({ redis, tenantKeys, signal });

    // 이후 매일 UTC 20:00 반복
    scheduleDailyAt({
        hour,
        minute,
        signal,
        fn: () => publishToAllTenants({ redis, tenantKeys, signal }),
    });
}
