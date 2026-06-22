// packages/worker/src/commands/pajamaHotCheck.js
// 잠옷-핫유저-분류: 글로벌 오케스트레이터가 매일 KST 05:00에 발행하는 커맨드.
// hot 유저 분류 + 스트럭쳐 목록 갱신을 1회 실행한다.

import { logger } from "@bonsai/shared";
import { runHotUserClassification } from "../pajama/hotUserScheduler.js";

const log = logger();

export default {
    name: "잠옷-핫유저-분류",
    discord: null,

    /**
     * @param {object} ctx
     * @param {import("@prisma/client").PrismaClient} ctx.prisma
     * @param {import("redis").RedisClientType} ctx.redis
     * @param {string} ctx.tenantKey
     */
    async execute(ctx) {
        const { prisma, redis, tenantKey } = ctx;

        if (!prisma) {
            log.warn("[cmd:잠옷-핫유저-분류] prisma 주입 없음");
            return { ok: false, data: { error: "시스템 설정 오류" } };
        }

        try {
            await runHotUserClassification({ prisma, redis, tenantKey });
            return { ok: true, data: {} };
        } catch (err) {
            log.warn("[cmd:잠옷-핫유저-분류] 실행 실패", { message: err?.message });
            return { ok: false, data: { error: err?.message ?? String(err) } };
        }
    },
};
