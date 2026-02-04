import { cmdDtNotify } from "./dtNotify.js";

/**
 * 글로벌 오케스트레이터 명령 맵.
 * - tenant worker와 분리된 네임스페이스를 유지한다.
 * @returns {Map<string, {execute: Function}>}
 */
export function getGlobalCommandMap() {
    const m = new Map();

    // 예) DT 오픈 알림 (단일 웹훅 1회 전송)
    m.set("dt.notify", cmdDtNotify);

    return m;
}
