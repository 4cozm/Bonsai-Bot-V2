// packages/worker/src/commands/index.js
import dev from "./dev.js";
import esiComplete from "./esiComplete.js";
import esiList from "./esiList.js";
import esiSignup from "./esiSignup.js";
import fuel from "./fuel.js";
import fuelDailyCheck from "./fuelDailyCheck.js";
import marketPrice from "./marketPrice.js";
import ping from "./ping.js";

export function getCommandDefinitions() {
    return [ping, dev, esiSignup, esiComplete, esiList, fuel, fuelDailyCheck, marketPrice];
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
