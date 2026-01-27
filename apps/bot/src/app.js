import "dotenv/config";
import { importVaultSecrets } from "../../../packages/adapters/src/keyvault/importVaultSecrets.js";

async function main() {
  try {
    console.log("[master] 부팅 시작");
    await importVaultSecrets();

    console.log("[master] 스텁 실행 중");

    // 프로세스 유지
    setInterval(() => {}, 60_000);
  } catch (err) {
    console.error("[master] 부팅 실패:", err?.message ?? err);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  console.log("[master] 종료(SIGINT)");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[master] 종료(SIGTERM)");
  process.exit(0);
});

main();
