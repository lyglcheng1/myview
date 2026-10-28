import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // `.mjs` tests cover the framework-free playground modules (plain JS, outside the
        // TS build) — e.g. the keyboard-shortcut policy in `playground/modules/shortcuts-core.js`.
        include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs'],
        environment: 'node',
        // The full suite runs ~190 files in parallel; jsdom-heavy browser tests (drawings
        // settings panel, price-style change) exceed vitest's 5000ms default under CPU
        // contention even though they pass in isolation. Raise the cap instead of serializing.
        testTimeout: 30_000,
    },
});
