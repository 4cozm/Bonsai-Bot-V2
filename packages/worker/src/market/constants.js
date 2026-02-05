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
    { typeId: 30370, name: "Fullerite-C50", volume: 1 },
    { typeId: 30371, name: "Fullerite-C60", volume: 1 },
    { typeId: 30372, name: "Fullerite-C70", volume: 1 },
    { typeId: 30373, name: "Fullerite-C72", volume: 1 },
    { typeId: 30374, name: "Fullerite-C84", volume: 2 },
    { typeId: 30375, name: "Fullerite-C28", volume: 2 },
    { typeId: 30376, name: "Fullerite-C32", volume: 5 },
    { typeId: 30377, name: "Fullerite-C320", volume: 5 },
    { typeId: 30378, name: "Fullerite-C540", volume: 10 },
]);

/** 기본 오어 12종 (변종 오어 제외). 표시명·volume 고정 */
export const MINERAL_ITEMS = Object.freeze([
    { typeId: 22, name: "Arkonor", volume: 16 },
    { typeId: 19, name: "Spodumain", volume: 16 },
    { typeId: 18, name: "Plagioclase", volume: 0.35 },
    { typeId: 1223, name: "Bistot", volume: 16 },
    { typeId: 1225, name: "Crokite", volume: 8 },
    { typeId: 1226, name: "Jaspet", volume: 2 },
    { typeId: 1227, name: "Omber", volume: 0.6 },
    { typeId: 1228, name: "Scordite", volume: 0.15 },
    { typeId: 1229, name: "Gneiss", volume: 16 },
    { typeId: 1230, name: "Veldspar", volume: 0.1 },
    { typeId: 1232, name: "Dark Ochre", volume: 8 },
    { typeId: 11396, name: "Mercoxit", volume: 40 },
]);

/** 아이스 산출물 7종. 표시명·volume 고정 */
export const ICE_ITEMS = Object.freeze([
    { typeId: 16272, name: "Heavy Water", volume: 1 },
    { typeId: 16273, name: "Liquid Ozone", volume: 1 },
    { typeId: 16274, name: "Helium Isotopes", volume: 1 },
    { typeId: 16275, name: "Strontium Clathrates", volume: 1 },
    { typeId: 17889, name: "Hydrogen Isotopes", volume: 1 },
    { typeId: 17888, name: "Nitrogen Isotopes", volume: 1 },
    { typeId: 17887, name: "Oxygen Isotopes", volume: 1 },
]);
