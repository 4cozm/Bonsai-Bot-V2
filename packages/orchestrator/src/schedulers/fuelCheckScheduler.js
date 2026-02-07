import { buildCmdEnvelope, logger, publishCmdToRedisStream } from "@bonsai/shared";

const log = logger();

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
 * DISCORD_TENANT_MAP (channelId:tenantKey,...) 파싱하여 tenantKey -> channelId 역매핑 반환.
 * @returns {Map<string, string>}
 */
function getTenantToChannelMap() {
    const raw = String(process.env.DISCORD_TENANT_MAP ?? "").trim();
    const map = new Map();
    if (!raw) return map;

    for (const chunk of raw.split(",")) {
        const part = chunk.trim();
        if (!part) continue;
        const idx = part.indexOf(":");
        if (idx <= 0 || idx === part.length - 1) continue;
        const channelId = part.slice(0, idx).trim();
        const tenantKey = part.slice(idx + 1).trim();
        if (channelId && tenantKey) map.set(tenantKey, channelId);
    }
    return map;
}

/**
 * FUEL_CHECK_TENANT_KEYS (쉼표 구분) 파싱.
 * @returns {string[]}
 */
function parseFuelCheckTenantKeys() {
    const raw = String(process.env.FUEL_CHECK_TENANT_KEYS ?? "").trim();
    if (!raw) return [];
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * 매일 9시 연료 일일체크 명령을 각 테넌트 Worker에 발행.
 * - prod에서만 초기화 시 기동 (isDev면 미등록).
 * - envelope.meta에 channelId, guildId 포함하여 Worker가 "전부 안전" 시 Master 브로드캐스트 요청 가능.
 */
export async function startFuelCheckScheduler({ redis, signal }) {
    const tenantKeys = parseFuelCheckTenantKeys();
    if (tenantKeys.length === 0) {
        log.info("[global:fuel] FUEL_CHECK_TENANT_KEYS 비어있음 - 연료 스케줄러 비활성화");
        return;
    }

    const tenantToChannel = getTenantToChannelMap();
    const guildId = String(process.env.DISCORD_GUILD_ID ?? "").trim();

    const hour = Number(process.env.FUEL_CHECK_HOUR ?? 9);
    const minute = Number(process.env.FUEL_CHECK_MINUTE ?? 0);

    log.info(
        `[global:fuel] 연료 일일체크 스케줄 등록 (매일 ${hour}:${String(minute).padStart(2, "0")}) tenants=${tenantKeys.length}`
    );

    scheduleDailyAt({
        hour,
        minute,
        signal,
        fn: async () => {
            if (signal?.aborted) return;

            for (const tenantKey of tenantKeys) {
                const channelId = tenantToChannel.get(tenantKey) ?? "";
                try {
                    const envelope = buildCmdEnvelope({
                        tenantKey,
                        cmd: "연료-일일체크",
                        args: "",
                        meta: {
                            discordUserId: "",
                            guildId,
                            channelId,
                            issuedAt: Math.floor(Date.now() / 1000),
                        },
                    });
                    await publishCmdToRedisStream({ redis, envelope });
                    log.info(
                        `[global:fuel] 발행 tenant=${tenantKey} channelId=${channelId || "(없음)"}`
                    );
                } catch (err) {
                    log.warn(`[global:fuel] 발행 실패 tenant=${tenantKey}`, {
                        message: err?.message,
                    });
                }
            }
        },
    });
}
