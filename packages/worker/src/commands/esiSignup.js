// packages/worker/src/commands/esiSignup.js
import { issueNonce, logger, signState } from "@bonsai/shared";
import { randomUUID } from "node:crypto";

const log = logger();

const EVE_AUTHORIZE_URL = "https://login.eveonline.com/v2/oauth/authorize/";
const STATE_TTL_SEC = 600; // 10분
const NONCE_TTL_SEC = 660; // state보다 약간 길게

export default {
    name: "esi-signup",
    discord: {
        name: "esi-signup",
        description: "EVE ESI 가입 링크 발급 (OAuth 후 Discord에서 승인 필요)",
        type: 1,
        options: [
            {
                type: 3,
                name: "nick",
                description: "디스코드 표시명(생략 시 서버 닉네임/유저명 사용)",
                required: false,
            },
        ],
    },

    /**
     * 가입 링크 발급: DiscordUser upsert, EsiRegistration PENDING 생성, state 발급, authorize URL 반환.
     * Master는 URL만 사용자에게 보여준다(해석 금지).
     *
     * @param {object} ctx
     * @param {import("redis").RedisClientType} ctx.redis
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {string} ctx.tenantKey
     * @param {any} envelope
     * @returns {Promise<{ok:boolean, data:any}>}
     */
    async execute(ctx, envelope) {
        const redis = ctx?.redis;
        const prisma = ctx?.prisma;
        const tenantKey = String(ctx?.tenantKey ?? "").trim();
        const meta = envelope?.meta ?? {};
        const discordUserId = String(meta.discordUserId ?? "").trim();
        const guildId = String(meta.guildId ?? "").trim();
        const channelId = String(meta.channelId ?? "").trim();
        const discordNick =
            String(meta.discordNick ?? "").trim() ||
            String(envelope?.args ?? "").trim() ||
            "Unknown";

        if (!discordUserId) {
            return { ok: false, data: { error: "discordUserId가 없습니다." } };
        }
        if (!redis) {
            log.warn("[cmd:esi-signup] redis 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }
        if (!prisma) {
            log.warn("[cmd:esi-signup] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }

        const secret = String(process.env.ESI_STATE_SECRET ?? "").trim();
        const clientId = String(process.env.EVE_ESI_CLIENT_ID ?? "").trim();
        const redirectUri = String(process.env.EVE_ESI_REDIRECT_URI ?? "").trim();
        const scope = String(process.env.EVE_ESI_SCOPE ?? "esi-character.read_character.v1").trim();

        if (!secret || !clientId || !redirectUri) {
            log.error(
                "[cmd:esi-signup] ESI 설정 누락 (ESI_STATE_SECRET, EVE_ESI_CLIENT_ID, EVE_ESI_REDIRECT_URI)"
            );
            return { ok: false, data: { error: "ESI 연동이 설정되지 않았습니다." } };
        }

        const stateNonce = randomUUID();
        const nonceKey = `bonsai:esi:nonce:${stateNonce}`;
        const issued = await issueNonce(redis, nonceKey, NONCE_TTL_SEC);
        if (!issued) {
            log.warn("[cmd:esi-signup] nonce 발급 실패(중복) stateNonce=" + stateNonce);
            return { ok: false, data: { error: "일시 오류. 다시 시도해 주세요." } };
        }

        const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SEC;
        const statePayload = {
            v: 1,
            discordId: discordUserId,
            discordNick,
            stateNonce,
            exp,
            tenantKey,
            guildId: guildId || undefined,
            channelId: channelId || undefined,
        };
        let stateStr;
        try {
            stateStr = signState(statePayload, secret);
        } catch (err) {
            log.error("[cmd:esi-signup] state 서명 실패", err);
            return { ok: false, data: { error: "state 생성 실패" } };
        }

        try {
            await prisma.discordUser.upsert({
                where: { id: discordUserId },
                create: { id: discordUserId },
                update: {},
            });
        } catch (err) {
            log.error("[cmd:esi-signup] DiscordUser upsert 실패", err);
            return { ok: false, data: { error: "DB 오류" } };
        }

        try {
            await prisma.esiRegistration.create({
                data: {
                    discordUserId,
                    stateNonce,
                    stateExpAt: new Date(exp * 1000),
                    discordNick,
                    status: "PENDING",
                    guildId: guildId || null,
                    channelId: channelId || null,
                },
            });
        } catch (err) {
            log.warn("[cmd:esi-signup] EsiRegistration 생성 실패(이미 동일 nonce?)", err);
            return { ok: false, data: { error: "등록 생성 실패. 다시 시도해 주세요." } };
        }

        const params = new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            redirect_uri: redirectUri,
            scope,
            state: stateStr,
        });
        const authorizeUrl = `${EVE_AUTHORIZE_URL}?${params.toString()}`;

        log.info(
            `[cmd:esi-signup] 링크 발급 완료 tenant=${tenantKey} discordId=${discordUserId} stateNonce=${stateNonce}`
        );

        return {
            ok: true,
            data: {
                embed: true,
                title: "EVE ESI 가입 링크",
                description:
                    "아래 링크로 EVE 로그인 후, 돌아오면 Discord에서 **승인 버튼**을 눌러 주세요.",
                fields: [
                    {
                        name: "링크",
                        value: `[EVE 로그인 (클릭)](${authorizeUrl})`,
                        inline: false,
                    },
                ],
                footer: `요청자: ${discordNick}`,
                // Master가 링크만 보여주기 위해 사용(해석 금지)
                authorizeUrl,
            },
        };
    },
};
