module.exports = {
    apps: [
        {
            name: "master",
            script: "apps/bot/src/app.js",
            watch: false,

            autorestart: false,
            max_restarts: 0,

            env: { RUN_MODE: "master" },
            env_production: { RUN_MODE: "master" },
        },
        {
            name: "cat",
            script: "apps/tenants/src/app.js",
            env: { RUN_MODE: "tenant-worker", TENANT: "cat" },
            env_production: { RUN_MODE: "tenant-worker", TENANT: "cat" },
            watch: false,
        },
        {
            name: "fish",
            script: "apps/tenants/src/app.js",
            env: { RUN_MODE: "tenant-worker", TENANT: "fish" },
            env_production: { RUN_MODE: "tenant-worker", TENANT: "fish" },
            watch: false,
        },
    ],
};
