// packages/worker/tests/stockDivisionRules.test.js
import { describe, expect, test } from "@jest/globals";
import { isTracked } from "../src/schedulers/stockDivisionRules.js";

describe("stockDivisionRules/isTracked", () => {
    test("컨테이너 없는 아이템은 규칙이 없으면 기본 추적한다", () => {
        expect(isTracked({ division: 2, containerItemId: null, containerName: null }, [])).toBe(
            true
        );
    });

    test("컨테이너 없는 아이템도 division 전체 제외 규칙이 있으면 안 걸린다", () => {
        const rules = [{ division: 1, containerName: "", tracked: false }];
        expect(isTracked({ division: 1, containerItemId: null, containerName: null }, rules)).toBe(
            false
        );
    });

    test("division 전체 규칙이 tracked:true면 명시적으로 켜져 있어도 그대로 추적한다", () => {
        const rules = [{ division: 5, containerName: "", tracked: true }];
        expect(isTracked({ division: 5, containerItemId: null, containerName: null }, rules)).toBe(
            true
        );
    });

    test("이름 붙은 컨테이너는 규칙이 없으면 기본 미추적이다", () => {
        expect(isTracked({ division: 4, containerItemId: 999, containerName: "학습지" }, [])).toBe(
            false
        );
    });

    test("이름 붙은 컨테이너는 tracked:true 규칙이 있어야 추적한다", () => {
        const rules = [{ division: 4, containerName: "드론", tracked: true }];
        expect(isTracked({ division: 4, containerItemId: 999, containerName: "드론" }, rules)).toBe(
            true
        );
    });

    test("같은 컨테이너라도 tracked:false 규칙이면 추적 안 한다", () => {
        const rules = [{ division: 4, containerName: "시체", tracked: false }];
        expect(isTracked({ division: 4, containerItemId: 999, containerName: "시체" }, rules)).toBe(
            false
        );
    });

    test("다른 division/컨테이너 이름의 규칙은 서로 영향을 주지 않는다", () => {
        const rules = [
            { division: 4, containerName: "드론", tracked: true },
            { division: 4, containerName: "학습지", tracked: false },
        ];
        expect(isTracked({ division: 4, containerItemId: 999, containerName: "모듈" }, rules)).toBe(
            false
        );
        expect(isTracked({ division: 6, containerItemId: 999, containerName: "드론" }, rules)).toBe(
            false
        );
    });

    // 회귀 테스트: 컨테이너 안에 있지만 이름을 못 알아낸(커스텀 이름 없음/ESI 조회 실패)
    // 경우 containerName이 null이 된다 — 이걸 "division에 직접 있음"과 구분 못 하면
    // 이름 없는 컨테이너 내용물이 규칙 없이도 기본 추적(true)돼 버려서, "이름 붙은
    // 컨테이너는 명시적으로 켜야 추적"이라는 설계 의도가 깨진다.
    test("컨테이너 안에 있지만 이름을 못 알아낸 경우도 기본 미추적이다", () => {
        expect(isTracked({ division: 4, containerItemId: 999, containerName: null }, [])).toBe(
            false
        );
    });

    test("이름 없는 컨테이너라도 division 전체 제외 규칙에는 걸린다", () => {
        const rules = [{ division: 1, containerName: "", tracked: false }];
        expect(isTracked({ division: 1, containerItemId: 999, containerName: null }, rules)).toBe(
            false
        );
    });

    // 회귀 테스트: division 전체 규칙의 자리표시자("")와 이름 못 알아낸 컨테이너의
    // containerName(null)은 절대 같은 값으로 취급되면 안 된다 — 그렇지 않으면 division
    // 전체를 tracked:true로 열어 둔 순간 그 안의 이름 없는 컨테이너까지 전부 같이
    // 추적돼 버린다(컨테이너는 항상 명시적으로 켜야 한다는 규칙이 깨짐).
    test("division 전체 tracked:true 규칙이 있어도 이름 없는 컨테이너까지 같이 켜지지 않는다", () => {
        const rules = [{ division: 5, containerName: "", tracked: true }];
        expect(isTracked({ division: 5, containerItemId: 999, containerName: null }, rules)).toBe(
            false
        );
    });

    // 회귀 테스트: 함선 개별 커스텀명(itemName) 기능 추가 후에도 isTracked는
    // itemName을 아예 안 본다 — division/컨테이너 기준 추적 여부가 함선이라고
    // 달라지면 안 된다(제외된 컨테이너 안 함선도 그대로 제외돼야 함).
    test("itemName이 있어도(함선) 결과는 division/컨테이너 기준과 동일하다", () => {
        const rules = [{ division: 4, containerName: "드론", tracked: true }];
        const withoutName = isTracked(
            { division: 4, containerItemId: 999, containerName: "드론" },
            rules
        );
        const withName = isTracked(
            { division: 4, containerItemId: 999, containerName: "드론", itemName: "custom-name" },
            rules
        );
        expect(withName).toBe(withoutName);
        expect(withName).toBe(true);
    });
});
