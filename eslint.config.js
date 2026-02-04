// eslint.config.js
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import globals from "globals";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// eslint-config-prettier를 flat config에서 가져오기 위한 호환 레이어
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
    // 모노레포에서 보통 린트 제외할 것들
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
            "**/coverage/**",
            "**/.next/**",
            "**/.turbo/**",
            "**/.cache/**",
            "**/out/**",
        ],
    },

    // JS 기본 추천 규칙
    js.configs.recommended,

    ...compat.extends("prettier"),

    {
        files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.node,
                ...globals.es2023,
            },
        },
        rules: {
            "no-console": "off",
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
        },
    },
];
