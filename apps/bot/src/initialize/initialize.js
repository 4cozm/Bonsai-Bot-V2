import { importVaultSecrets } from "../../../../packages/adapters/src/keyvault/importVaultSecrets.js";

async function connectDb() {
  // TODO: Prisma 연결 등
  console.log("🧩 DB 연결 단계 (TODO)");
}

async function startDiscordBot() {
  // TODO: discord.js login 등
  console.log("🧩 디스코드 봇 시작 단계 (TODO)");
}

async function startCronJobs() {
  // TODO: node-cron schedule 등
  console.log("🧩 크론 잡 시작 단계 (TODO)");
}

export async function initialize() {
  // 1) Vault에서 공용 + 테넌트 env 로드 (실패 시 내부에서 즉시 종료)
  await importVaultSecrets();

  // 2) 이후 단계들
  await connectDb();
  await startDiscordBot();
  await startCronJobs();
}
