// packages/worker/src/commands/issueSupplyLink.js
import { issueMagicLinkToken, logger } from "@bonsai/shared";

const log = logger();
const LINK_TTL_SEC = 300; // 5분

function parseAdminIds(envValue) {
    return new Set(
        String(envValue ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
    );
}

export default {
    name: "보급",
    discord: {
        name: "보급",
        description: "재고 관리 페이지 로그인 링크 발급 (관리자 전용, 5분 유효)",
        type: 1,
        options: [],
    },

    /**
     * @param {object} ctx
     * @param {import("redis").RedisClientType} ctx.redis
     * @param {string} ctx.tenantKey
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const discordUserId = String(envelope?.meta?.discordUserId ?? "").trim();
        const tenantKey = String(ctx?.tenantKey ?? "").trim();
        const redis = ctx?.redis;

        if (!discordUserId || !tenantKey) {
            return { ok: false, data: { error: "요청 정보가 없습니다.", ephemeralReply: true } };
        }
        if (!redis) {
            log.warn("[cmd:보급] redis 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류", ephemeralReply: true } };
        }

        const adminIds = parseAdminIds(process.env.ADMIN_DISCORD_IDS);
        if (!adminIds.has(discordUserId)) {
            log.warn(
                `[cmd:보급] 관리자 아님 discordUserId=${discordUserId} tenantKey=${tenantKey}`
            );
            return {
                ok: false,
                data: { error: "이 명령은 관리자만 사용할 수 있습니다.", ephemeralReply: true },
            };
        }

        const apiBaseUrl = String(process.env.STOCK_API_BASE_URL ?? "").trim();
        if (!apiBaseUrl) {
            log.warn("[cmd:보급] STOCK_API_BASE_URL 미설정");
            return { ok: false, data: { error: "시스템 설정 오류", ephemeralReply: true } };
        }

        const token = await issueMagicLinkToken(
            redis,
            { discordId: discordUserId, tenantKey },
            LINK_TTL_SEC
        );
        const loginUrl = `${apiBaseUrl.replace(/\/$/, "")}/auth/consume?token=${token}`;

        log.info(
            `[cmd:보급] 로그인 링크 발급 discordUserId=${discordUserId} tenantKey=${tenantKey}`
        );

        return {
            ok: true,
            data: {
                embed: true,
                title: "재고 관리 로그인 링크",
                description: `${loginUrl}\n\n5분 안에 클릭해주세요. 1회용입니다.`,
                color: 0x5b9dd9,
                ephemeralReply: true,
            },
        };
    },
};
