/** @type {import('jest').Config} */
module.exports = {
  testMatch: ["<rootDir>/apps/**/tests/**/*.(test|spec).js", "<rootDir>/packages/**/tests/**/*.(test|spec).js"],
  testEnvironment: "node",
  collectCoverage: true,
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["lcov", "text-summary"],
};
