import { ipcMain, Notification } from "electron";

/**
 * Whitelisted IPC channels.
 *
 * `alert:notify` — renderer asks for a native desktop notification
 * (used by the alert engine, docs/plans/alerts.md). The payload is validated
 * minimally; unknown channels are never registered.
 */
interface AlertNotifyPayload {
    title: string;
    body: string;
}

export function registerIpc(): void {
    ipcMain.on("alert:notify", (_event, payload: AlertNotifyPayload) => {
        const title = typeof payload?.title === "string" ? payload.title : "Vela Dashboard";
        const body = typeof payload?.body === "string" ? payload.body : "";
        if (Notification.isSupported()) {
            new Notification({ title, body }).show();
        }
    });
}