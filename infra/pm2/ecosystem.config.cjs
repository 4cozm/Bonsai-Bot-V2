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
            name: "global",
            script: "apps/global/src/app.js",
            watch: false,

            // 전역 오케스트레이터는 테넌트와 무관하게 1개만 실행된다.
            env: { RUN_MODE: "global" },
            env_production: { RUN_MODE: "global" },
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
