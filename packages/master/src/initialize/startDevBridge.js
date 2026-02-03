// packages/master/src/initialize/startDevBridge.js
import { createRedisClient, publishJson } from "@bonsai/external";
import { logger } from "@bonsai/shared";
import { publishCmdToRedisStream } from "../bus/publishCmdToRedisStream.js";
import { runRedisStreamsResultConsumer } from "../bus/redisStreamsResultConsumer.js";
import { runSqsCommandConsumer } from "../bus/runDevSqsCommandConsumer.js";
import {
    buildDevSqsQueueUrl,
    deriveDevKey,
    getAzureSignedInIdentity,
} from "./deriveDevSqsQueueUrl.js";

const log = logger();

/**
 * Dev Master 브릿지:
 * 1) SQS(cmd) -> Redis Streams(cmd) 로 라우팅
 * 2) Redis Streams(result) -> SNS(result) 로 브릿지
 *
 * 주의: result consume 로직은 prod/dev 공통(runRedisStreamsResultConsumer)이고,
 *       dev에서는 onResult에서 SNS publish로 분기한다.
 *
 * @param {object} params
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<void>}
 */
export async function startDevBridge({ redis: redisFromCaller, signal } = {}) {
    const region = String(process.env.AWS_REGION ?? "").trim();
    const prefix = String(process.env.DEV_SQS_QUEUE_URL ?? "").trim();

    if (!region) throw new Error("AWS_REGION이 비어있습니다.");
    if (!prefix) throw new Error("DEV_SQS_QUEUE_URL(prefix)가 비어있습니다.");

    const identity = await getAzureSignedInIdentity();
    const devKey = deriveDevKey(identity);
    const queueUrl = buildDevSqsQueueUrl({ prefix, devKey });

    const redis = redisFromCaller ?? (await createRedisClient());
    const ownsRedis = !redisFromCaller;

    log.info(`[devBridge] 시작 queueUrl=${queueUrl} devKey=${devKey}`);

    try {
        await Promise.all([
            // (1) cmd 브릿지: SQS -> Redis Streams(cmd)
            runSqsCommandConsumer({
                queueUrl,
                region,
                devKey,
                signal,
                onCmd: async (envelope) => {
                    await publishCmdToRedisStream({ redis, envelope });
                },
            }),

            // (2) result 브릿지: Redis Streams(result) -> SNS(result)
            runRedisStreamsResultConsumer({
                redis,
                signal,
                group: "bonsai-devmaster",
                consumer: `devmaster-${process.pid}`,
                onResult: async (resultEnv) => {
                    // ✅ prod master가 result만 받도록 attribute로 type 지정
                    await publishJson(resultEnv, { type: "result" });
                    log.info(
                        `[devBridge] SNS(result) 발행 inReplyTo=${resultEnv.inReplyTo} ok=${resultEnv.ok}`
                    );
                },
            }),
        ]);
    } finally {
        try {
            if (ownsRedis) await redis.quit();
        } catch {
            // 무시
        }
    }
}
