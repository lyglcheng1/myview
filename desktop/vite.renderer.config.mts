import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Renderer build configuration for the desktop app.
 *
 * The renderer IS the playground dashboard page: Vela is imported straight from
 * `src/` (no library build step needed), and the dashboard HTML/TS is built into
 * `desktop/dist/renderer` for Electron to load via `file://`.
 *
 * The same config serves the dev server (`npm run dev:server`) on port 5190 so
 * the Electron shell can load `http://127.0.0.1:5190/dashboard.html` with HMR.
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: resolve(repoRoot, "playground"),
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5190,
    strictPort: true,
  },
  build: {
    outDir: resolve(repoRoot, "desktop", "dist", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(repoRoot, "playground", "dashboard.html"),
    },
  },
});