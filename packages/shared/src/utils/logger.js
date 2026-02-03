import fs from "fs";
import path from "path";
import winston from "winston";
import DiscordWarnWebhookTransport from "./discordWarnWebhookTransport.js";

let _logger = null;
const LOG_DIR = "logs";

function isDevMode() {
    return (process.env.isDev || "").toLowerCase() === "true";
}

const levels = {
    warn: 0,
    error: 1,
    info: 2,
};

function buildServiceName() {
    const runMode = (process.env.RUN_MODE || "").trim();
    const tenant = (process.env.TENANT || "").trim();

    if (runMode === "master") return "bonsai-master";

    if (runMode === "tenant-worker") {
        if (tenant) return `bonsai-tenant-${tenant}`;
        return "bonsai-tenant";
    }

    if (runMode) return `bonsai-${runMode}`;
    return "bonsai";
}

function ensureDir(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
    } catch (e) {
        process.stderr.write(`[logger] 로그 폴더 생성 실패: ${e?.message ?? e}\n`);
    }
}

function normalizeMeta(meta) {
    if (meta instanceof Error) return meta;
    if (meta && typeof meta === "object") return meta;
    if (meta != null) return meta;
    return null;
}

function buildFormat() {
    const { combine, timestamp, printf, splat } = winston.format;

    return combine(
        timestamp(),
        splat(),
        printf((info) => {
            const ts = info.timestamp;
            const lvl = info.level;
            const msg = info.message;

            // logger().info("메시지", err)
            // -> splat이 처리해주지 못하는 경우도 있어서, 아래에서 info.meta를 우선 본다.
            let extra = "";

            const meta = info.meta;
            if (meta instanceof Error) extra = meta.stack || meta.message || "";
            else if (meta && typeof meta === "object") {
                try {
                    extra = JSON.stringify(meta);
                } catch {
                    extra = String(meta);
                }
            } else if (meta != null) extra = String(meta);

            return extra ? `[${lvl}] ${ts} ${msg} | ${extra}` : `[${lvl}] ${ts} ${msg}`;
        })
    );
}

function createLoggerInstance() {
    const dev = isDevMode();

    const transports = [];

    // 항상 콘솔 출력
    transports.push(
        new winston.transports.Console({
            level: "info",
        })
    );

    if (!dev) {
        const logDir = LOG_DIR;
        ensureDir(logDir);

        transports.push(
            new winston.transports.File({
                level: "info",
                filename: path.join(logDir, "app.log"),
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 10,
                tailable: true,
            })
        );

        const webhookUrl = (process.env.DISCORD_WARN_WEBHOOK_URL || "").trim();
        const serviceName = buildServiceName();

        transports.push(
            new DiscordWarnWebhookTransport({
                level: "warn",
                webhookUrl,
                serviceName,
            })
        );
    }

    const base = winston.createLogger({
        levels,
        level: "info",
        format: buildFormat(),
        transports,
    });

    // “logger().info("메세지", err)” 형태를 위해 래핑:
    // 2번째 인자를 info.meta로 강제 주입
    const wrap = {};
    for (const lvl of Object.keys(levels)) {
        wrap[lvl] = (message, meta) => {
            base.log({
                level: lvl,
                message,
                meta: normalizeMeta(meta),
            });
        };
    }

    // 필요하면 raw 접근도 가능
    wrap.raw = base;

    return wrap;
}

export function logger() {
    if (_logger) return _logger;
    _logger = createLoggerInstance();
    return _logger;
}
