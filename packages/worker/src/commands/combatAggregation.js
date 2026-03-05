// packages/worker/src/commands/combatAggregation.js
//
// /전투집계 — Pathfinder 전투 로그 집계 API를 호출하여 dmc_helper에서 로그 수집을 시작한다.
// HMAC-SHA256(X-Signature)으로 path-v2.catalyst-for-you.com 인증.
//
import crypto from "node:crypto";
import { logger } from "@bonsai/shared";

const log = logger();

const PATHFINDER_BASE_URL = "https://path-v2.catalyst-for-you.com";

export default {
    name: "전투집계",
    discord: {
        name: "전투집계",
        description: "전투 로그 집계를 시작합니다 (dmc_helper, 5분간 유효)",
        type: 1,
        options: [
            {
                name: "start_time",
                description: "집계 시작 시각 (KST, ISO8601 또는 Unix timestamp)",
                type: 3, // STRING
                required: true,
            },
            {
                name: "end_time",
                description: "집계 종료 시각 (KST, ISO8601 또는 Unix timestamp)",
                type: 3, // STRING
                required: true,
            },
        ],
    },

    /**
     * Pathfinder POST /api/CombatAggregation/request 호출 후 결과 임베드 반환.
     *
     * @param {object} ctx
     * @param {any} envelope
     * @returns {Promise<{ok: boolean, data: any}>}
     */
    async execute(ctx, envelope) {
        const meta = envelope?.meta ?? {};
        const requesterName = String(meta.requesterName ?? "").trim();

        let args = {};
        try {
            const raw = envelope?.args;
            if (typeof raw === "string" && raw.trim()) args = JSON.parse(raw);
            else if (raw && typeof raw === "object") args = raw;
        } catch {
            return { ok: false, data: { error: "옵션 파싱에 실패했습니다." } };
        }

        const startTime = String(args.start_time ?? "").trim();
        const endTime = String(args.end_time ?? "").trim();
        if (!startTime || !endTime) {
            return {
                ok: false,
                data: { error: "start_time과 end_time을 모두 입력해주세요." },
            };
        }

        const secret = String(process.env.DISCORD_TO_PF_HMAC ?? "").trim();
        if (!secret) {
            log.error("[전투집계] DISCORD_TO_PF_HMAC 미설정");
            return { ok: false, data: { error: "서버 설정 오류입니다. (HMAC 미설정)" } };
        }

        const body = {
            startTime,
            endTime,
            ...(requesterName && { requesterName }),
        };
        const rawBody = JSON.stringify(body);
        const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

        const url = `${PATHFINDER_BASE_URL}/api/CombatAggregation/request`;
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Signature": signature,
                },
                body: rawBody,
                signal: AbortSignal.timeout(15_000),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = data?.message ?? res.statusText ?? `HTTP ${res.status}`;
                log.warn("[전투집계] Pathfinder API 실패", { status: res.status, message: msg });
                return {
                    ok: false,
                    data: { error: `집계 요청 실패: ${msg}` },
                };
            }

            const requestId = data?.requestId ?? "(없음)";
            const expiresIn = data?.expiresIn ?? 300;
            log.info("[전투집계] 요청 성공", { requestId, requesterName: requesterName || "(없음)" });

            return {
                ok: true,
                data: {
                    embed: true,
                    title: "전투 로그 집계 시작",
                    description:
                        "dmc_helper에서 전투 로그 수집이 시작되었습니다. " +
                        "약 5분 후 공지 채널에 집계 완료 안내가 전송됩니다.",
                    fields: [
                        { name: "요청 ID", value: requestId, inline: true },
                        { name: "유효 시간", value: `${expiresIn}초`, inline: true },
                        { name: "집계 기간", value: `${startTime} ~ ${endTime}`, inline: false },
                        ...(requesterName ? [{ name: "요청자", value: requesterName, inline: true }] : []),
                    ],
                    color: 0x57f287,
                    timestamp: true,
                },
            };
        } catch (e) {
            const msg = e?.message ?? String(e);
            log.error("[전투집계] 요청 예외", { message: msg });
            return {
                ok: false,
                data: { error: `집계 요청 중 오류: ${msg}` },
            };
        }
    },
};
