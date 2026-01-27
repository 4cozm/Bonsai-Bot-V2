import { spawn } from "node:child_process";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true });
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} 실패(code=${code})`));
    });
  });
}

async function main() {
  const isDev = (process.env.isDev || "").trim() === "true";
  if (!isDev) {
    console.log("[dev-pm2] isDev=true에서만 사용하세요.");
    process.exit(1);
  }

  try {
    console.log("[dev-pm2] PM2 시작");
    await run("npx", ["pm2", "start", ".\\infra\\pm2\\ecosystem.config.cjs"]);

    console.log("[dev-pm2] 로그 출력 (Ctrl+C로 종료 시 전체 stop)");
    const logs = spawn("npx", ["pm2", "logs"], { stdio: "inherit", shell: true });

    const stopAll = async () => {
      try {
        console.log("\n[dev-pm2] 종료 신호 감지, pm2 stop all");
        await run("npx", ["pm2", "stop", "all"]);
      } catch (e) {
        console.log(`[dev-pm2] stop 실패: ${e?.message ?? e}`);
      } finally {
        logs.kill("SIGINT");
        process.exit(0);
      }
    };

    process.on("SIGINT", stopAll);
    process.on("SIGTERM", stopAll);
  } catch (err) {
    console.log(`[dev-pm2] 실패: ${err?.message ?? err}`);
    process.exit(1);
  }
}

main();
