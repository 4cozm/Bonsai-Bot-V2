import "dotenv/config";
import { initialize } from "./initialize/initialize.js";

async function main() {
  try {
    console.log("🚀 Bonsai Bot 부팅 시작");
    await initialize();
    console.log("✅ Bonsai Bot 부팅 완료");
  } catch (err) {
    console.error("❌ Bonsai Bot 부팅 실패:", err?.message ?? err);
    process.exit(1);
  }
}

main();
