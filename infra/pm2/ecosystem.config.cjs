module.exports = {
    apps: [
        {
            name: "master",
            script: "apps/bot/src/app.js",
            watch: false,

            autorestart: false,
            max_restarts: 0,

            env: { isDev: "true", RUN_MODE: "master" },
            env_production: { isDev: "false", RUN_MODE: "master" },
        },
        {
            name: "cat",
            script: "apps/tenants/src/app.js",
            env: { isDev: "true", RUN_MODE: "tenant-worker", TENANT: "cat" },
            env_production: { isDev: "false", RUN_MODE: "tenant-worker", TENANT: "cat" },
            watch: false,
        },
        {
            name: "fish",
            script: "apps/tenants/src/app.js",
            env: { isDev: "true", RUN_MODE: "tenant-worker", TENANT: "fish" },
            env_production: { isDev: "false", RUN_MODE: "tenant-worker", TENANT: "fish" },
            watch: false,
        },
    ],
};
