// Optional Electron desktop bridge — `window.velaDesktop`, exposed by the
// desktop shell's preload through contextBridge (desktop/electron/preload.ts).
// In a plain browser the bridge is absent and every call is a no-op, so the
// playground keeps working unchanged. Design: docs/plans/alerts.md.
export interface DesktopBridge {
    readonly platform?: string;
    notify(title: string, body: string): void;
}

declare global {
    interface Window {
        velaDesktop?: DesktopBridge;
    }
}

/** Show a native desktop notification (Electron) or do nothing in a browser. */
export function notifyDesktop(title: string, body: string): void {
    const win = globalThis.window as (Window & { velaDesktop?: DesktopBridge }) | undefined;
    try {
        win?.velaDesktop?.notify(title, body);
    } catch {
        /* bridge unavailable → silent */
    }
}