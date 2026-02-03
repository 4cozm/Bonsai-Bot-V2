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
    try {
        console.log("[dev-pm2] PM2 시작");
        await run("npx", ["pm2", "start", "./infra/pm2/ecosystem.config.cjs"]);

        console.log("[dev-pm2] 로그 출력 (Ctrl+C로 종료 시 전체 delete)");
        const logs = spawn("npx", ["pm2", "logs"], { stdio: "inherit", shell: true });

        const cleanup = async (signal) => {
            try {
                console.log(`\n[dev-pm2] 종료 신호 감지(${signal}), pm2 delete all`);
                await run("npx", ["pm2", "delete", "all"]);
            } catch (e) {
                console.log(`[dev-pm2] delete 실패: ${e?.message ?? e}`);
            } finally {
                logs.kill("SIGINT");
                process.exit(0);
            }
        };

        process.on("SIGINT", () => cleanup("SIGINT"));
        process.on("SIGTERM", () => cleanup("SIGTERM"));
    } catch (err) {
        console.log(`[dev-pm2] 실패: ${err?.message ?? err}`);
        process.exit(1);
    }
}

main();
