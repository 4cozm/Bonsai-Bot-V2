// packages/worker/src/commands/index.js
import dev from "./dev.js";
import ping from "./ping.js";
// 앞으로 여기만 추가

export function getCommandDefinitions() {
    return [ping, dev];
}

export function getDiscordSchemas() {
    return getCommandDefinitions().map((c) => c.discord);
}

export function getCommandMap() {
    const map = new Map();
    for (const c of getCommandDefinitions()) map.set(c.name, c);
    return map;
}
