// packages/worker/src/schedulers/stockDivisionRules.js
// StockDivisionRule 평가. "모드" 개념 없이 두 가지 기본값만 있다:
//   - 컨테이너 없이 division에 직접 있는 아이템: 규칙 없으면 기본 추적함
//   - 이름 붙은 컨테이너 안 아이템: tracked:true 규칙이 명시적으로 있어야만 추적(기본 미추적)
// 이러면 admin이 "이건 추적 안 해도 됨" 몇 개만 끄거나, 컨테이너는 원하는 것만 켜면 된다 —
// 새로 생긴 이름 모를 컨테이너가 조용히 추적 대상에 끼어드는 일이 없다.

/**
 * 분기 기준은 containerItemId(컨테이너 안에 있는지 자체)이지 containerName(이름을
 * 알아냈는지)이 아니다 — 이름을 못 알아낸(커스텀 이름 없는/ESI 조회 실패) 컨테이너도
 * "컨테이너 안"인 건 똑같아서, containerName만 보면 "division에 직접 있음"과 구분이
 * 안 돼 기본 추적(true)으로 새 버린다. 이름 없는 컨테이너는 admin이 규칙을 걸 수 있는
 * 대상이 애초에 아니므로 컨테이너 분기의 기본값(미추적)을 그대로 받는 게 맞다.
 *
 * @param {{division:number, containerItemId:number|null, containerName:string|null}} target
 * @param {{division:number, containerName:string|null, tracked:boolean}[]} rules
 * @returns {boolean}
 */
export function isTracked({ division, containerItemId, containerName }, rules) {
    if (containerItemId == null) {
        const whole = rules.find((r) => r.division === division && r.containerName == null);
        return whole ? whole.tracked : true;
    }

    const specific = rules.find(
        (r) => r.division === division && r.containerName === containerName
    );
    return specific ? specific.tracked === true : false;
}
