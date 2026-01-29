import { runSqsCommandConsumer } from "../bus/runDevSqsCommandConsumer.js";
import {
    buildDevSqsQueueUrl,
    deriveDevKey,
    getAzureSignedInIdentity,
} from "./deriveDevSqsQueueUrl.js";

/**
 * Dev Master 브릿지: SQS(cmd) -> onCmd(보통 Redis Streams publish)
 *
 * @param {object} params
 * @param {(envelope:any) => Promise<void>} params.onCmd
 * @param {AbortSignal} [params.signal]
 */
export async function startDevBridge({ onCmd, signal }) {

    const region = String(process.env.AWS_REGION ?? "").trim();
    const prefix = String(process.env.DEV_SQS_QUEUE_URL ?? "").trim();
    if (!region) throw new Error("AWS_REGION이 비어있습니다.");
    if (!prefix) throw new Error("DEV_SQS_QUEUE_URL(prefix)가 비어있습니다.");

    const identity = await getAzureSignedInIdentity();
    const devKey = deriveDevKey(identity);
    const queueUrl = buildDevSqsQueueUrl({ prefix, devKey });

    await runSqsCommandConsumer({ queueUrl, region, devKey, onCmd, signal });
}
