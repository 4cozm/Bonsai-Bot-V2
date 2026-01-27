import "dotenv/config";
import { importVaultSecrets } from "../../../packages/adapters/src/keyvault/importVaultSecrets.js";

function mustGet(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`환경변수 누락: ${name}`);
  return v;
}

async function main() {
  try {
    const tenant = mustGet("TENANT");
    console.log(`[worker:${tenant}] 부팅 시작`);

    await importVaultSecrets();

    console.log(`[worker:${tenant}] 스텁 실행 중`);

    setInterval(() => {}, 60_000);
  } catch (err) {
    console.error("[worker] 부팅 실패:", err?.message ?? err);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  console.log("[worker] 종료(SIGINT)");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[worker] 종료(SIGTERM)");
  process.exit(0);
});

main();
