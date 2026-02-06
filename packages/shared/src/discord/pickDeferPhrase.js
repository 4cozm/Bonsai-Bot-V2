// packages/shared/src/discord/pickDeferPhrase.js
import { randomInt } from "node:crypto";
import { DEFER_PHRASES_KO } from "./deferPhrases.ko.js";

/**
 * DeferReply(처리중) 문구를 랜덤으로 1개 선택한다.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.phrases] - 커스텀 문구 풀(미지정 시 기본 KO 풀 사용)
 * @param {string} [opts.fallback] - 문구 풀이 비었을 때 사용할 기본 문구
 * @returns {string}
 */
export function pickDeferPhrase(opts = {}) {
    const phrases = Array.isArray(opts.phrases) ? opts.phrases : DEFER_PHRASES_KO;
    const fallback = typeof opts.fallback === "string" ? opts.fallback : "처리 중…";

    if (!phrases || phrases.length === 0) return fallback;

    const idx = randomInt(0, phrases.length);
    const picked = phrases[idx];

    return typeof picked === "string" && picked.length > 0 ? picked : fallback;
}
