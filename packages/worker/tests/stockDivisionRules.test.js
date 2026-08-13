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
        const rules = [{ division: 1, containerName: null, tracked: false }];
        expect(isTracked({ division: 1, containerItemId: null, containerName: null }, rules)).toBe(
            false
        );
    });

    test("division 전체 규칙이 tracked:true면 명시적으로 켜져 있어도 그대로 추적한다", () => {
        const rules = [{ division: 5, containerName: null, tracked: true }];
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
        const rules = [{ division: 1, containerName: null, tracked: false }];
        expect(isTracked({ division: 1, containerItemId: 999, containerName: null }, rules)).toBe(
            false
        );
    });
});
