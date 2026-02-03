import { logger } from "@bonsai/shared";
import crypto from "node:crypto";
import { getDiscordCommandSchemas } from "./commandRegistry.js";

const log = logger();

function normalizeCommandsForHash(commands) {
    const arr = Array.isArray(commands) ? commands : [];
    return arr
        .map(normalizeCommandForHash)
        .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));
}

function normalizeCommandForHash(cmd) {
    const name = String(cmd?.name ?? "");
    const description = String(cmd?.description ?? "");
    const type = cmd?.type ?? 1;

    return {
        name,
        description,
        type,
        default_member_permissions: cmd?.default_member_permissions ?? null,
        dm_permission: cmd?.dm_permission ?? true,
        nsfw: cmd?.nsfw ?? false,
        options: normalizeOptionsForHash(cmd?.options),
    };
}

function normalizeOptionsForHash(options) {
    const arr = Array.isArray(options) ? options : [];
    return arr
        .map((o) => ({
            name: String(o?.name ?? ""),
            description: String(o?.description ?? ""),
            type: o?.type ?? 3,
            // Discord가 반환에서 false를 채우는 케이스를 맞추기 위해 boolean으로 고정
            required: Boolean(o?.required),
            autocomplete: Boolean(o?.autocomplete),

            // 필요한 비교 필드만 남김(원하면 여기 항목 추가)
            min_value: o?.min_value ?? null,
            max_value: o?.max_value ?? null,
            min_length: o?.min_length ?? null,
            max_length: o?.max_length ?? null,
            channel_types: Array.isArray(o?.channel_types) ? [...o.channel_types].sort() : [],

            choices: normalizeChoicesForHash(o?.choices),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeChoicesForHash(choices) {
    const arr = Array.isArray(choices) ? choices : [];
    return arr
        .map((c) => ({
            name: String(c?.name ?? ""),
            value: c?.value,
        }))
        .sort((a, b) => {
            const an = `${a.name}:${String(a.value)}`;
            const bn = `${b.name}:${String(b.value)}`;
            return an.localeCompare(bn);
        });
}

function stableSortObject(value) {
    if (Array.isArray(value)) return value.map(stableSortObject);

    if (value && typeof value === "object") {
        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = stableSortObject(value[key]);
        }
        return sorted;
    }
    return value;
}

function sha256Of(obj) {
    const normalized = stableSortObject(obj);
    const json = JSON.stringify(normalized);
    return crypto.createHash("sha256").update(json).digest("hex");
}

async function discordApi(method, path, body) {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        // 예상 가능한 설정 오류
        log.error("[commands] DISCORD_TOKEN이 없음");
        throw new Error("DISCORD_TOKEN이 없음");
    }

    const url = `https://discord.com/api/v10${path}`;
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bot ${token}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = text;
    }

    if (!res.ok) {
        log.warn("[commands] Discord API 실패", { method, path, status: res.status, json });
        throw new Error(`Discord API 실패: ${res.status}`);
    }

    return json;
}

/**
 * 길드 스코프 슬래시 커맨드를 “정답 스키마(레지스트리)”로 조건부 overwrite 한다.
 *
 * @returns {Promise<{changed: boolean, desiredHash: string, remoteHash: string, count: number}>}
 */
export async function deployGuildCommands() {
    const appId = process.env.DISCORD_APP_ID;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!appId) {
        log.error("[commands] DISCORD_APP_ID가 없음");
        throw new Error("DISCORD_APP_ID가 없음");
    }
    if (!guildId) {
        log.error("[commands] DISCORD_GUILD_ID가 없음");
        throw new Error("DISCORD_GUILD_ID가 없음");
    }

    const desiredSchemas = getDiscordCommandSchemas();
    if (!Array.isArray(desiredSchemas)) {
        log.error("[commands] 레지스트리 스키마가 배열이 아님");
        throw new Error("레지스트리 스키마가 배열이 아님");
    }

    const desiredHash = sha256Of(normalizeCommandsForHash(desiredSchemas));

    const remoteRaw = await discordApi("GET", `/applications/${appId}/guilds/${guildId}/commands`);
    const remote = Array.isArray(remoteRaw) ? remoteRaw : [];
    const remoteHash = sha256Of(normalizeCommandsForHash(remote));

    if (desiredHash === remoteHash) {
        log.info(`[commands] 변경 없음. overwrite 생략`);
        return { changed: false, desiredHash, remoteHash, count: desiredSchemas.length };
    }

    log.info(`[commands] 변경 감지. overwrite 진행`);

    await discordApi("PUT", `/applications/${appId}/guilds/${guildId}/commands`, desiredSchemas);

    log.info(`[commands] overwrite 완료 (count=${desiredSchemas.length})`);
    return { changed: true, desiredHash, remoteHash, count: desiredSchemas.length };
}
