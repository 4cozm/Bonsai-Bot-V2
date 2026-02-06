// packages/master/tests/deriveDevSqsQueueUrl.test.js
import { describe, expect, test } from "@jest/globals";
import { deriveDevKey, buildDevSqsQueueUrl } from "../src/initialize/deriveDevSqsQueueUrl.js";

describe("master/initialize/deriveDevSqsQueueUrl", () => {
    describe("deriveDevKey", () => {
        test("빈 identity → throw", () => {
            expect(() => deriveDevKey("")).toThrow("dev 식별 문자열이 비어있습니다.");
            expect(() => deriveDevKey(null)).toThrow("dev 식별 문자열이 비어있습니다.");
        });
        test("이메일만 → @ 앞부분 반환", () => {
            expect(deriveDevKey("17328rm@gmail.com")).toBe("17328rm");
        });
        test("live.com#id → id 반환", () => {
            expect(deriveDevKey("live.com#17328rm")).toBe("17328rm");
        });
        test("live.com#id@gmail.com → id 반환", () => {
            expect(deriveDevKey("live.com#17328rm@gmail.com")).toBe("17328rm");
        });
    });

    describe("buildDevSqsQueueUrl", () => {
        test("prefix 없음 → throw", () => {
            expect(() => buildDevSqsQueueUrl({ prefix: "", devKey: "x" })).toThrow(
                "DEV_SQS_QUEUE_URL(prefix)가 비어있습니다."
            );
        });
        test("devKey 없음 → throw", () => {
            expect(() => buildDevSqsQueueUrl({ prefix: "https://sqs.../", devKey: "" })).toThrow(
                "devKey가 비어있습니다."
            );
        });
        test("둘 다 있으면 prefix + devKey 반환", () => {
            expect(
                buildDevSqsQueueUrl({
                    prefix: "https://sqs.ap-northeast-2.amazonaws.com/123/",
                    devKey: "17328rm",
                })
            ).toBe("https://sqs.ap-northeast-2.amazonaws.com/123/17328rm");
        });
    });
});
