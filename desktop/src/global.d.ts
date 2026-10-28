import type { VelaDesktopApi } from "../electron/preload";

/**
 * Renderer-side type augmentation for the Electron shell bridge.
 * The playground dashboard page is served in both plain browsers and Electron;
 * `window.velaDesktop` exists only inside the Electron shell.
 */
declare global {
    interface Window {
        velaDesktop?: VelaDesktopApi;
    }
}

export {};