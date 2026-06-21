// packages/worker/tests/structureAttackAlert.parse.test.js
// 회귀 테스트: 건물 공격 알림 text(YAML) 파싱.
// 샘플은 실제 ESI notifications 덤프(/attackdump 진단)에서 채취.
// 핵심 보호: TowerAlertMsg는 solarSystemID(대문자 S), 다른 타입은 solarsystemID(소문자)로 와서
// parseTextKey가 줄 시작 고정 + 대소문자 무시여야 한다. typeID가 structureTypeID에 오매칭돼서도 안 된다.
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
    extractNumericId,
    parseTextKey,
    resolveTypeName,
} from "../src/schedulers/structureAttackAlertScheduler.js";

// --- 실제 덤프 샘플 ---
const TOWER_ALERT_TEXT = `aggressorAllianceID: 99010787
aggressorCorpID: 98532165
aggressorID: 2115819543
armorValue: 1.0
hullValue: 1.0
moonID: 40441451
shieldValue: 0.25349253856717185
solarSystemID: 31001748
typeID: 20062`;

const STRUCTURE_UNDER_ATTACK_TEXT = `allianceID: 99010576
armorPercentage: 0.0
charID: 1925123782
corpName: Ixtab.
hullPercentage: 98.79812177046092
shieldPercentage: 9.7663465042031e-10
solarsystemID: 31001748
structureID: &id001 1054465738190
structureShowInfoData:
- showinfo
- 35832
- *id001
structureTypeID: 35832`;

const STRUCTURE_LOST_SHIELDS_TEXT = `solarsystemID: 31001748
structureID: &id001 1054435531175
structureShowInfoData:
- showinfo
- 35825
- *id001
structureTypeID: 35825
timeLeft: 2555298681040
timestamp: 134266055050000000
vulnerableTime: 9000000000`;

describe("structureAttackAlert/parseTextKey", () => {
    test("TowerAlertMsg: solarSystemID(대문자 S)도 대소문자 무시로 파싱", () => {
        expect(parseTextKey(TOWER_ALERT_TEXT, "solarsystemID")).toBe("31001748");
    });

    test("StructureUnderAttack: solarsystemID(소문자)도 파싱", () => {
        expect(parseTextKey(STRUCTURE_UNDER_ATTACK_TEXT, "solarsystemID")).toBe("31001748");
    });

    test("TowerAlertMsg: typeID 파싱", () => {
        expect(parseTextKey(TOWER_ALERT_TEXT, "typeID")).toBe("20062");
    });

    test("structureID는 YAML anchor 포함(&id001 ...) → 끝 숫자만 추출", () => {
        const raw = parseTextKey(STRUCTURE_UNDER_ATTACK_TEXT, "structureID");
        expect(raw).toBe("&id001 1054465738190");
        expect(extractNumericId(raw)).toBe("1054465738190");
    });

    test("StructureLostShields: structureTypeID 파싱", () => {
        expect(parseTextKey(STRUCTURE_LOST_SHIELDS_TEXT, "structureTypeID")).toBe("35825");
    });

    test("가드: typeID가 structureTypeID 줄에 오매칭되지 않음(줄 시작 고정)", () => {
        // structureTypeID만 있고 typeID 줄은 없는 텍스트 → null이어야 함
        expect(parseTextKey(STRUCTURE_UNDER_ATTACK_TEXT, "typeID")).toBeNull();
    });

    test("없는 키 → null", () => {
        expect(parseTextKey(TOWER_ALERT_TEXT, "structureID")).toBeNull();
    });
});

describe("structureAttackAlert/resolveTypeName", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("매핑에 있는 타입(Astrahus 35832) → 큐레이션 한글명, ESI 미호출", async () => {
        const spy = jest.fn();
        globalThis.fetch = spy;
        const name = await resolveTypeName(null, "35832");
        expect(name).toBe("허스");
        expect(spy).not.toHaveBeenCalled();
    });

    test("매핑에 없는 타입(POS 20062) → ESI 폴백 이름", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ name: "Caldari Control Tower Small" }),
        });
        const name = await resolveTypeName(null, "20062");
        expect(name).toBe("Caldari Control Tower Small");
    });

    test("ESI 실패 시 null", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
        const name = await resolveTypeName(null, "20062");
        expect(name).toBeNull();
    });

    test("잘못된 typeId → null (ESI 미호출)", async () => {
        const spy = jest.fn();
        globalThis.fetch = spy;
        expect(await resolveTypeName(null, null)).toBeNull();
        expect(await resolveTypeName(null, "0")).toBeNull();
        expect(spy).not.toHaveBeenCalled();
    });
});
