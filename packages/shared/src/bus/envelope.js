// packages/shared/src/bus/envelope.js
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

const log = logger();

/**
 * 공통 cmd envelope(코어)를 생성한다.
 * - 입력 소스(SQS/Redis)와 무관하게 "worker가 이해하는 최소 계약"만 만든다.
 * - dev 전용 필드(targetDev 등)는 이 함수가 절대 알지 못한다. (밖에서 옵션으로 붙여라)
 *
 * @param {object} input
 * @param {string} input.tenantKey
 * @param {string} input.cmd
 * @param {string} [input.args]
 * @param {object} input.meta
 * @param {string} input.meta.discordUserId
 * @param {string} input.meta.guildId
 * @param {string} input.meta.channelId
 * @param {number} [input.meta.issuedAt] - epoch seconds
 * @param {object} [input.replyTo]
 * @returns {object} envelope
 */
export function buildCmdEnvelope(input) {
    const tenantKey = String(input?.tenantKey ?? "").trim();
    const cmd = String(input?.cmd ?? "").trim();
    const args = input?.args == null ? "" : String(input.args);

    const metaRaw = input?.meta ?? {};
    const meta = {
        discordUserId: String(metaRaw.discordUserId ?? ""),
        guildId: String(metaRaw.guildId ?? ""),
        channelId: String(metaRaw.channelId ?? ""),
        issuedAt:
            typeof metaRaw.issuedAt === "number" && Number.isFinite(metaRaw.issuedAt)
                ? metaRaw.issuedAt
                : Math.floor(Date.now() / 1000),
    };

    if (!tenantKey) {
        log.error("[envelope] tenantKey 누락", { tenantKey });
        throw new Error("tenantKey 누락");
    }
    if (!meta.discordUserId || !meta.guildId || !meta.channelId) {
        log.error("[envelope] meta 필수 값 누락", meta);
        throw new Error("envelope meta 필수 값 누락");
    }
    if (!cmd) {
        log.error("[envelope] cmd 누락", { cmd });
        throw new Error("cmd 누락");
    }

    const envelope = {
        id: randomUUID(), // correlationId
        type: "cmd",
        tenantKey,
        cmd,
        args,
        meta,
    };

    // replyTo는 옵션(답장이 필요없이 출력만 필요할수도 있으니까)
    if (input?.replyTo != null) {
        envelope.replyTo = input.replyTo;
    }

    return envelope;
}

/**
 * 공통 result envelope를 생성한다.
 * (E2E 왕복 닫을 때 master 소비용)
 *
 * @param {object} input
 * @param {string} input.inReplyTo
 * @param {boolean} input.ok
 * @param {object|null} [input.data]
 * @param {object} [input.meta]
 * @returns {object} result envelope
 */
export function buildResultEnvelope(input) {
    const inReplyTo = String(input?.inReplyTo ?? "");
    const ok = Boolean(input?.ok);
    const data = input?.data ?? null;

    if (!inReplyTo) {
        log.error("[envelope] result inReplyTo 누락");
        throw new Error("result inReplyTo 누락");
    }

    const envelope = {
        id: randomUUID(),
        type: "result",
        inReplyTo,
        ok,
        data,
        meta: input?.meta ?? {},
    };

    return envelope;
}
