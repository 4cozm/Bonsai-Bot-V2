import discord from "discord.js";

const { Client, Intents } = discord;

export function createDiscordClient({ intents } = {}) {
  const client = new Client({
    intents: intents ?? [Intents.FLAGS.GUILDS],
  });

  return client;
}
