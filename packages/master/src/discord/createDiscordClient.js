// packages/master/src/discord/createDiscordClient.js
import { logger } from "@bonsai/shared";
import { Client, GatewayIntentBits } from "discord.js";

const log = logger();

/**
 * Discord.js Client를 생성한다.
 * @param {object} [opts]
 * @param {number[]} [opts.intents]
 * @returns {Client}
 */
export function createDiscordClient(opts = {}) {
    const intents =
        Array.isArray(opts.intents) && opts.intents.length > 0
            ? opts.intents
            : [GatewayIntentBits.Guilds];

    log.info("[discord] client 생성", { intentsCount: intents.length });

    return new Client({ intents });
}
