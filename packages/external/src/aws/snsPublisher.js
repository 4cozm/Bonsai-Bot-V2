import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { logger } from "@bonsai/shared";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "node:https";

const log = logger();

let _snsClient;

/**
 * 고정 SNS Topic으로 JSON 메시지를 발행한다.
 * - SNS는 WS 같은 지속 연결이 아니라, Publish API를 호출하는 모델이다.
 * - Client는 1회 생성 후 재사용, keepAlive로 소켓 재사용을 노린다.
 *
 * @param {object} message - JSON 직렬화 가능한 객체
 * @param {object} [attributes] - MessageAttributes (String only)
 * @returns {Promise<{messageId: string}>}
 */
export async function publishJson(message, attributes) {
    const region = process.env.AWS_REGION;
    const topicArn = process.env.AWS_SNS_TOPIC;

    if (!region) throw new Error("AWS_REGION이 설정되지 않음");
    if (!topicArn) throw new Error("AWS_SNS_TOPIC이 설정되지 않음");

    if (!_snsClient) {
        const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
        _snsClient = new SNSClient({
            region,
            requestHandler: new NodeHttpHandler({ httpsAgent }),
        });
        log.info("[SNS] 클라이언트 생성 완료");
    }

    const MessageAttributes = attributes
        ? Object.fromEntries(
              Object.entries(attributes).map(([key, value]) => [
                  key,
                  { DataType: "String", StringValue: String(value) },
              ])
          )
        : undefined;

    try {
        const cmd = new PublishCommand({
            TopicArn: topicArn,
            Message: JSON.stringify(message),
            MessageAttributes,
        });

        const res = await _snsClient.send(cmd);
        const messageId = res?.MessageId ?? "";

        log.info(`[SNS] 발행 성공 messageId=${messageId}`);
        return { messageId };
    } catch (err) {
        log.error("[SNS] 발행 실패", err);
        throw err;
    }
}
