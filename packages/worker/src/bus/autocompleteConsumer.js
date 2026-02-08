// packages/worker/src/bus/autocompleteConsumer.js
import { logger } from "@bonsai/shared";
import { getCommandMap } from "../commands/index.js";

const commandMap = getCommandMap();

/**
 * Redis List(BLPOP) 기반 autocomplete fast-path consumer.
 *
 * Master가 `RPUSH bonsai:ac:{tenantKey} {requestJSON}` 으로 요청을 넣으면
 * 이 consumer가 즉시 꺼내서 commandMap의 autocomplete 핸들러를 실행하고,
 * 결과를 `SET bonsai:ac:res:{requestId} {responseJSON} EX 10` 에 저장한다.
 *
 * Master는 해당 키를 폴링하여 결과를 가져간다.
 *
 * @param {object} params
 * @param {import("redis").RedisClientType} params.redis
 * @param {import("@prisma/client").PrismaClient} params.prisma
 * @param {string} params.tenantKey
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<void>}
 */
export async function runAutocompleteConsumer({ redis, prisma, tenantKey, signal }) {
    const log = logger();
    const t = String(tenantKey ?? "").trim();
    if (!t) throw new Error("tenantKey가 비어있습니다.");

    const listKey = `bonsai:ac:${t}`;

    log.info(`[worker:ac] autocomplete consumer 시작 tenant=${t} listKey=${listKey}`);

    while (!signal?.aborted) {
        try {
            // BLPOP: 200ms 블록 후 없으면 null 반환 → 루프 재진입으로 abort 검사
            const item = await redis.blPop(listKey, 0.2);
            if (!item) continue;

            const raw = String(item.element ?? "").trim();
            if (!raw) continue;

            let request = null;
            try {
                request = JSON.parse(raw);
            } catch {
                log.warn(`[worker:ac] JSON 파싱 실패 tenant=${t} raw=${raw.slice(0, 200)}`);
                continue;
            }

            const { requestId, commandName, discordUserId, focusedValue } = request;
            if (!requestId || !commandName) {
                log.warn(`[worker:ac] 필수 필드 누락 tenant=${t}`, { requestId, commandName });
                continue;
            }

            const def = commandMap.get(commandName);
            if (!def || typeof def.autocomplete !== "function") {
                log.warn(`[worker:ac] autocomplete 핸들러 없음 tenant=${t} cmd=${commandName}`);
                // 빈 결과 저장 → Master가 빈 배열 반환
                await redis.set(`bonsai:ac:res:${requestId}`, "[]", { EX: 10 });
                continue;
            }

            let choices = [];
            try {
                const ctx = { prisma, redis, tenantKey: t, log, commandMap };
                choices = await def.autocomplete(ctx, {
                    discordUserId: discordUserId ?? "",
                    focusedValue: focusedValue ?? "",
                });
            } catch (err) {
                log.warn(`[worker:ac] autocomplete 실행 실패 tenant=${t} cmd=${commandName}`, err);
            }

            if (!Array.isArray(choices)) choices = [];

            const resKey = `bonsai:ac:res:${requestId}`;
            await redis.set(resKey, JSON.stringify(choices), { EX: 10 });
        } catch (err) {
            const msg = err?.message ?? String(err);
            // 연결 끊김 등 일시적 오류 → 짧은 대기 후 재시도
            log.warn(`[worker:ac] consume 루프 오류 tenant=${t}: ${msg}`);
            await new Promise((r) => setTimeout(r, 500));
        }
    }

    log.info(`[worker:ac] autocomplete consumer 종료 tenant=${t}`);
}
