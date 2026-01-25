module.exports = {
  apps: [
    {
      name: "cat",
      script: "apps/bot/src/app.js",

      env: {
        TENANT: "cat",
        isDev: "true",
      },

      env_production: {
        TENANT: "cat",
        isDev: "false",
      },

      watch: false,
    },
    {
      name: "fish",
      script: "apps/bot/src/app.js",

      env: {
        TENANT: "fish",
        isDev: "true",
      },
      env_production: {
        TENANT: "fish",
        isDev: "false",
      },

      watch: false,
    },
  ],
};
