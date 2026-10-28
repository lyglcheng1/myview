// ESLint flat config for the desktop app (Electron main/preload + renderer types).
// Kept deliberately simple: syntax + recommended rules, no type-aware checks.
// @ts-check
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
    {
        files: ["electron/**/*.ts", "vite.renderer.config.mts", "src/**/*.d.ts", "scripts/**/*.cjs"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
            },
        },
        rules: {
            ...tseslint.configs.recommended.rules,
        },
    },
    {
        ignores: ["node_modules/**", "dist/**", "dist-electron/**"],
    },
);