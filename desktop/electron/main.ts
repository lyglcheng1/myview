import { app, BrowserWindow, shell } from "electron";
import * as path from "node:path";
import { registerIpc } from "./ipc";

/**
 * Electron main process for the Vela dashboard.
 *
 * Development: loads the Vite dev server (http://localhost:5190/dashboard.html)
 * so the renderer hot-reloads against the Vela source tree.
 * Production: loads the built renderer from ../dist/renderer/dashboard.html.
 *
 * Security baseline (docs/plans/architecture.md):
 *  - contextIsolation: true, nodeIntegration: false, sandbox: true
 *  - no remote content is ever loaded; only the local dev server / bundled files
 *  - window.open and navigation away from the app are denied
 */
const DEV_SERVER_URL = process.env.VELA_DASHBOARD_DEV === "1"
    ? "http://127.0.0.1:5190/dashboard.html"
    : null;

function createMainWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        backgroundColor: "#0e1117",
        autoHideMenuBar: true,
        title: "Vela Dashboard",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    });

    if (DEV_SERVER_URL) {
        void win.loadURL(DEV_SERVER_URL);
    } else {
        void win.loadFile(path.join(__dirname, "..", "dist", "renderer", "dashboard.html"));
    }

    // Never open new windows inside the app; external links go to the system browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https:") || url.startsWith("http:")) {
            void shell.openExternal(url);
        }
        return { action: "deny" };
    });

    // Block in-app navigation away from the dashboard page.
    win.webContents.on("will-navigate", (event, url) => {
        if (url !== win.webContents.getURL()) {
            event.preventDefault();
        }
    });

    return win;
}

app.whenReady().then(() => {
    registerIpc();
    createMainWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});