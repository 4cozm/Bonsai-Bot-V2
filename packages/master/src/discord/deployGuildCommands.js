import { logger } from "@bonsai/shared";
import crypto from "node:crypto";
import { getDiscordCommandSchemas } from "./commandRegistry.js";

const log = logger();

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

function pickComparableCommandFields(cmd) {
    const { name, description, options, type, default_member_permissions, dm_permission, nsfw } =
        cmd;

    return {
        name,
        description,
        options: options ?? [],
        type: type ?? 1,
        default_member_permissions: default_member_permissions ?? null,
        dm_permission: dm_permission ?? null,
        nsfw: nsfw ?? null,
    };
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
 * - apps는 스키마를 몰라도 된다 (내부에서 레지스트리 읽음)
 * - 삭제/재등록 분리 없이 overwrite 1방으로 동기화
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

    const desiredComparable = desiredSchemas.map(pickComparableCommandFields);
    const desiredHash = sha256Of(desiredComparable);

    const remoteRaw = await discordApi("GET", `/applications/${appId}/guilds/${guildId}/commands`);
    const remote = Array.isArray(remoteRaw) ? remoteRaw : [];
    const remoteComparable = remote.map(pickComparableCommandFields);
    const remoteHash = sha256Of(remoteComparable);

    if (desiredHash === remoteHash) {
        log.info(`[commands] 변경 없음. overwrite 생략 (hash=${desiredHash})`);
        return { changed: false, desiredHash, remoteHash, count: desiredSchemas.length };
    }

    log.info(`[commands] 변경 감지. overwrite 진행 (remote=${remoteHash} desired=${desiredHash})`);

    await discordApi("PUT", `/applications/${appId}/guilds/${guildId}/commands`, desiredSchemas);

    log.info(`[commands] overwrite 완료 (count=${desiredSchemas.length})`);
    return { changed: true, desiredHash, remoteHash, count: desiredSchemas.length };
}
