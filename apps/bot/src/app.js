import "dotenv/config";
import { createDiscordClient } from "../../../packages/adapters/src/discord/createDiscordClient.js";
import { importVaultSecrets } from "../../../packages/adapters/src/keyvault/importVaultSecrets.js";

async function main() {
  console.log("[master] 부팅 시작");

  await importVaultSecrets();

  const client = createDiscordClient();

  client.once("ready", async () => {
    const tag = client.user?.tag ?? "(unknown)";
    const gid = (process.env.DISCORD_GUILD_ID || "").trim();

    console.log(`[master] 로그인 완료: ${tag}`);

    if (gid) {
      const g = client.guilds.cache.get(gid);
      if (g) console.log(`[master] 대상 길드 캐시 확인: ${g.name} (${g.id})`);
      else console.log(`[master] 대상 길드가 캐시에 없음: ${gid}`);
    } else {
      console.log("[master] DISCORD_GUILD_ID 미설정 (로그만 생략)");
    }
  });

  client.on("error", (err) => {
    console.error("[master] Discord client error:", err?.message ?? err);
  });

  client.on("shardError", (err) => {
    console.error("[master] Discord shard error:", err?.message ?? err);
  });

  const shutdown = async (signal) => {
    try {
      console.log(`[master] 종료 요청(${signal}) - 디스코드 연결 정리`);
      await client.destroy();
    } catch (e) {
      console.log(`[master] 종료 정리 중 오류: ${e?.message ?? e}`);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[master] Discord 로그인 시도");
  await client.login(process.env.DISCORD_TOKEN);

  // 프로세스 유지 (ready 이후에도 살아있음)
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  console.error("[master] 부팅 실패:", err?.message ?? err);
  process.exit(1);
});
