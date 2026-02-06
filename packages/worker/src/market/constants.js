/**
 * 마켓 시세 조회용 상수: 허브, Fullerite 9종, 기본 오어 12종, 아이스 산출물 7종.
 * 표시명은 모두 코드 고정 (한글 로컬/캐시 미사용).
 */

/** 5대 허브: region_id, station_id, label, stationName(임베드 설명용) */
export const HUBS = Object.freeze({
    jita: {
        regionId: 10000002,
        stationId: 60003760,
        label: "Jita",
        stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
    },
    amarr: {
        regionId: 10000043,
        stationId: 60008494,
        label: "Amarr",
        stationName: "Amarr VIII (Oris) - Emperor Family Academy",
    },
    dodixie: {
        regionId: 10000032,
        stationId: 60011866,
        label: "Dodixie",
        stationName: "Dodixie IX - Moon 20 - Federation Navy Assembly Plant",
    },
    rens: {
        regionId: 10000030,
        stationId: 60004588,
        label: "Rens",
        stationName: "Rens VI - Moon 8 - Brutor Tribe Treasury",
    },
    hek: {
        regionId: 10000042,
        stationId: 60005686,
        label: "Hek",
        stationName: "Hek VIII - Moon 12 - Boundless Creation Factory",
    },
});

/** Discord 슬래시 명령 hub 옵션 choices */
export const HUB_CHOICES = Object.freeze([
    { name: "지타", value: "jita" },
    { name: "아마르", value: "amarr" },
    { name: "헤크", value: "hek" },
    { name: "도딕시", value: "dodixie" },
    { name: "렌스", value: "rens" },
]);

/** Fullerite 9종 (웜홀 가스). typeId 30370~30378, 표시명·volume 고정 */
export const FULLERITE_ITEMS = Object.freeze([
    { typeId: 30370, name: "풀러라이트-C50", volume: 1 },
    { typeId: 30371, name: "풀러라이트-C60", volume: 1 },
    { typeId: 30372, name: "풀러라이트-C70", volume: 1 },
    { typeId: 30373, name: "풀러라이트-C72", volume: 2 },
    { typeId: 30374, name: "풀러라이트-C84", volume: 2 },
    { typeId: 30375, name: "풀러라이트-C28", volume: 2 },
    { typeId: 30376, name: "풀러라이트-C32", volume: 5 },
    { typeId: 30377, name: "풀러라이트-C320", volume: 5 },
    { typeId: 30378, name: "풀러라이트-C540", volume: 10 },
]);

/** 기본 오어 12종 (변종 오어 제외). 표시명·volume 고정 */
export const MINERAL_ITEMS = Object.freeze([
    { typeId: 62568, name: "압축된 아르카노르", volume: 0.16 },
    { typeId: 62572, name: "압축된 스포듀마인", volume: 0.16 },
    { typeId: 62528, name: "압축된 플레지오클레이스", volume: 0.0035 },
    { typeId: 62564, name: "압축된 비스토트", volume: 0.16 },
    { typeId: 62560, name: "압축된 크로카이트", volume: 0.16 },
    { typeId: 62540, name: "압축된 자스페트", volume: 0.02 },
    { typeId: 62532, name: "압축된 옴버", volume: 0.006 },
    { typeId: 62520, name: "압축된 스코다이트", volume: 0.0015 },
    { typeId: 62552, name: "압축된 니스", volume: 0.05 },
    { typeId: 62516, name: "압축된 벨드스파", volume: 0.001 },
    { typeId: 62556, name: "압축된 다크 오커", volume: 0.08 },
    { typeId: 62586, name: "압축된 메르코시트", volume: 0.4 },
]);

/** 아이스 산출물 7종. 표시명·volume 고정 */
export const ICE_ITEMS = Object.freeze([
    { typeId: 16272, name: "중수", volume: 0.4 },
    { typeId: 16273, name: "액체 오존", volume: 0.4 },
    { typeId: 16274, name: "헬륨 동위원소", volume: 0.03 },
    { typeId: 16275, name: "스트론튬 클라트레이트", volume: 3.0 },
    { typeId: 17889, name: "수소 동위원소", volume: 0.03 },
    { typeId: 17888, name: "질소 동위원소", volume: 0.03 },
    { typeId: 17887, name: "산소 동위원소", volume: 0.03 },
]);
