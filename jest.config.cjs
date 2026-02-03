/** @type {import('jest').Config} */
module.exports = {
    testRegex: ["(/|\\\\)(apps|packages)(/|\\\\).*?(/|\\\\)tests(/|\\\\).*\\.(test|spec)\\.js$"],
    testEnvironment: "node",

    collectCoverage: true,
    coverageDirectory: "<rootDir>/coverage",
    coverageReporters: ["lcov", "text-summary"],
};
