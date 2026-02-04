module.exports = {
    apps: [
        {
            name: "master",
            script: "apps/master/src/app.js",
            watch: false,

            autorestart: false,
            max_restarts: 0,

            env: { RUN_MODE: "master" },
            env_production: { RUN_MODE: "master" },
        },
        {
            name: "CAT",
            script: "apps/tenants/src/app.js",
            env: { RUN_MODE: "tenant-worker", TENANT: "CAT" },
            env_production: { RUN_MODE: "tenant-worker", TENANT: "CAT" },
            watch: false,
        },
        {
            name: "FISH",
            script: "apps/tenants/src/app.js",
            env: { RUN_MODE: "tenant-worker", TENANT: "FISH" },
            env_production: { RUN_MODE: "tenant-worker", TENANT: "FISH" },
            watch: false,
        },
    ],
};
