// packages/worker/src/commands/index.js
import attackNotifDump from "./attackNotifDump.js";
import dev from "./dev.js";
import esiComplete from "./esiComplete.js";
import esiList from "./esiList.js";
import esiSignup from "./esiSignup.js";
import fleetCommander from "./fleetCommander.js";
import fuel from "./fuel.js";
import fuelDailyCheck from "./fuelDailyCheck.js";
import marketPrice from "./marketPrice.js";
import ping from "./ping.js";

export function getCommandDefinitions() {
    return [
        ping,
        dev,
        esiSignup,
        esiComplete,
        esiList,
        fuel,
        fuelDailyCheck,
        marketPrice,
        fleetCommander,
        attackNotifDump, // dev 전용 진단(슬래시 미등록): /dev cmd:attackDump
    ];
}

export function getDiscordSchemas() {
    return getCommandDefinitions()
        .filter((c) => c.discord != null)
        .map((c) => c.discord);
}

export function getCommandMap() {
    const map = new Map();
    for (const c of getCommandDefinitions()) map.set(c.name, c);
    return map;
}
