import { logger } from "../utils/logger.js";

const log = logger();

const GLOBAL_CMD_STREAM = "bonsai:cmd:global";

/**
 * cmd envelope를 bonsai:cmd:global 스트림으로 재발행한다.
 * Tenant Worker가 "전역 처리 대상" 명령을 받았을 때만 호출하며,
 * payload에 scope: "global", tenantKey: "global"을 넣어 Global Worker가 재발행 루프에 빠지지 않게 한다.
 * envelope.id는 그대로 유지해 Master의 pendingMap 매칭(inReplyTo)이 유지된다.
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {object} params.envelope - 원본 cmd envelope (id, cmd, args, meta 등)
 * @returns {Promise<string>} redis entry id
 */
export async function publishToGlobalCmdStream({ redis, envelope }) {
    if (!envelope || envelope.type !== "cmd") {
        throw new Error("envelope(type=cmd)가 필요합니다.");
    }

    const forwarded = {
        ...envelope,
        tenantKey: "global",
        scope: "global",
    };

    const payload = JSON.stringify(forwarded);
    const id = await redis.xAdd(GLOBAL_CMD_STREAM, "*", { payload });

    log.info(
        `[bus] global stream publish ok stream=${GLOBAL_CMD_STREAM} entryId=${id} envelopeId=${envelope.id ?? ""} cmd=${envelope.cmd ?? ""}`
    );

    return id;
}
