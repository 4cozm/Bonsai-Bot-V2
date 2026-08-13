// packages/api/src/stock/burnRate.js
// "소진 예상일" 계산. 원래 프론트(bonsai-supply app.js의 burnRate())에 있던
// 로직을 백엔드로 옮겼다 — typeId가 뭔지는 프론트가 알아야 하지만, "이 속도로
// 언제 바닥나는가"는 순수 숫자 계산이라 백엔드가 한 곳에서만 하는 게 맞다고
// 판단함(목록 응답에 30일치 원본 이력을 통째로 실어 보내지 않아도 됨).

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 최근 windowDays 동안의 일평균 소진 속도. 감소분만 더한다 — 보급이 들어온
 * 계단은 소비가 아니므로 빼고 세야 실제 소진 속도가 나온다.
 *
 * 프론트 원본은 "고정 간격 가정 + 인덱스" 로 날짜 폭을 셌는데, 동기화가 가끔
 * 밀리면(실측 확인됨) 그 가정이 깨진다 — 여기서는 각 표본의 실제 sampledAt
 * 간격을 그대로 쓴다.
 *
 * @param {{sampledAt: Date, quantity: number}[]} history sampledAt 오름차순 정렬 필요
 * @param {number} windowDays
 * @returns {number} 하루당 소진량(0 이상, 소비가 없으면 0)
 */
export function computeBurnRatePerDay(history, windowDays) {
    if (history.length < 2) return 0;

    const cutoff = history[history.length - 1].sampledAt.getTime() - windowDays * DAY_MS;
    const windowed = history.filter((p) => p.sampledAt.getTime() >= cutoff);
    if (windowed.length < 2) return 0;

    let drop = 0;
    for (let i = 1; i < windowed.length; i++) {
        if (windowed[i].quantity < windowed[i - 1].quantity) {
            drop += windowed[i - 1].quantity - windowed[i].quantity;
        }
    }

    const spanDays =
        (windowed[windowed.length - 1].sampledAt.getTime() - windowed[0].sampledAt.getTime()) /
        DAY_MS;
    return spanDays > 0 ? drop / spanDays : 0;
}

/**
 * 이 속도로 며칠 뒤 바닥나는지. 소비가 없으면(rate<=0) null — JSON엔
 * Infinity가 없어서 "무제한/걱정 없음"을 null로 표현한다(프론트가 그렇게 해석).
 * @param {number} stocked
 * @param {number} burnRatePerDay
 * @returns {number | null}
 */
export function computeDaysLeft(stocked, burnRatePerDay) {
    if (burnRatePerDay <= 0) return null;
    return stocked / burnRatePerDay;
}
