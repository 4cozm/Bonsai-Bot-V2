// packages/worker/src/commands/index.js
import dev from "./dev.js";
import esiAssetDebug from "./esiAssetDebug.js";
import esiComplete from "./esiComplete.js";
import esiList from "./esiList.js";
import esiSignup from "./esiSignup.js";
import fleetCommander from "./fleetCommander.js";
import fuel from "./fuel.js";
import fuelDailyCheck from "./fuelDailyCheck.js";
import issueSupplyLink from "./issueSupplyLink.js";
import marketPrice from "./marketPrice.js";
import pajamaHotCheck from "./pajamaHotCheck.js";
import ping from "./ping.js";
import registerTrackedStructure from "./registerTrackedStructure.js";
import setStockDivisionRule from "./setStockDivisionRule.js";

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
        pajamaHotCheck,
        esiAssetDebug,
        registerTrackedStructure,
        setStockDivisionRule,
        issueSupplyLink,
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
