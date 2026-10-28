import { contextBridge, ipcRenderer } from "electron";

/**
 * The minimal, whitelisted API exposed to the renderer through contextBridge.
 * The renderer never touches Node or ipcRenderer directly.
 *
 * The dashboard page uses this opportunistically (window.velaDesktop is optional):
 *  - `notify(title, body)` asks the main process to show a native notification.
 *  - `platform` / `versions` let the page adapt its UI (sounds, etc.).
 */
export interface VelaDesktopApi {
    readonly platform: string;
    readonly versions: {
        readonly electron: string;
        readonly chrome: string;
        readonly node: string;
    };
    notify(title: string, body: string): void;
}

const api: VelaDesktopApi = {
    platform: process.platform,
    versions: Object.freeze({
        electron: process.versions.electron ?? "",
        chrome: process.versions.chrome ?? "",
        node: process.versions.node ?? "",
    }),
    notify(title: string, body: string): void {
        ipcRenderer.send("alert:notify", { title, body });
    },
};

contextBridge.exposeInMainWorld("velaDesktop", api);