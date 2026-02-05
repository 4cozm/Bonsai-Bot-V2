/**
 * 마켓 시세 조회용 상수: 허브, Fullerite 9종, 웜홀 관련 광물/얼음 산출물.
 */

/** Jita / Amarr region_id, station_id */
export const HUBS = Object.freeze({
    jita: { regionId: 10000002, stationId: 60003760, label: "Jita" },
    amarr: { regionId: 10000043, stationId: 60008494, label: "Amarr" },
});

/** Fullerite 9종 (type_id, 이름, m³ 단위 부피) */
export const FULLERITE_ITEMS = Object.freeze([
    { typeId: 30375, name: "Fullerite C28", volume: 10 },
    { typeId: 30376, name: "Fullerite C32", volume: 10 },
    { typeId: 30377, name: "Fullerite C50", volume: 10 },
    { typeId: 30378, name: "Fullerite C60", volume: 10 },
    { typeId: 30379, name: "Fullerite C70", volume: 10 },
    { typeId: 30380, name: "Fullerite C72", volume: 10 },
    { typeId: 30381, name: "Fullerite C84", volume: 10 },
    { typeId: 30382, name: "Fullerite C320", volume: 10 },
    { typeId: 30383, name: "Fullerite C540", volume: 10 },
]);

/** 웜홀 채굴/반응/제작에서 자주 쓰는 광물·얼음 산출물 (type_id, 이름, m³) */
export const MINERAL_ITEMS = Object.freeze([
    { typeId: 22, name: "Arkonor", volume: 16 },
    { typeId: 1223, name: "Bistot", volume: 16 },
    { typeId: 1229, name: "Crokite", volume: 16 },
    { typeId: 1225, name: "Dark Ochre", volume: 8 },
    { typeId: 17865, name: "Gneiss", volume: 5 },
    { typeId: 19, name: "Spodumain", volume: 16 },
    { typeId: 11396, name: "Mercoxit", volume: 40 },
    { typeId: 18, name: "Plagioclase", volume: 0.35 },
    { typeId: 1227, name: "Omber", volume: 0.6 },
    { typeId: 1226, name: "Jaspet", volume: 2 },
    { typeId: 1228, name: "Scordite", volume: 0.15 },
    { typeId: 1230, name: "Veldspar", volume: 0.1 },
    { typeId: 16272, name: "Heavy Water", volume: 1 },
    { typeId: 16274, name: "Helium Isotopes", volume: 1 },
    { typeId: 16273, name: "Hydrogen Isotopes", volume: 1 },
    { typeId: 16275, name: "Liquid Ozone", volume: 1 },
    { typeId: 16276, name: "Nitrogen Isotopes", volume: 1 },
    { typeId: 16277, name: "Oxygen Isotopes", volume: 1 },
    { typeId: 16278, name: "Strontium Clathrates", volume: 1 },
]);
