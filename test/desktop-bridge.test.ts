import { describe, expect, it, vi, afterEach } from "vitest";
import { notifyDesktop } from "../playground/desktopBridge";
import dashboardSource from "../playground/dashboard.ts?raw";

// The desktop shell (desktop/) exposes `window.velaDesktop.notify` through the
// preload's contextBridge. In a plain browser the bridge is absent and the
// dashboard must keep working silently. Design: docs/plans/alerts.md.

function setWindow(value: unknown): void {
    (globalThis as { window?: unknown }).window = value;
}

describe("notifyDesktop", () => {
    const originalWindow = globalThis.window;

    afterEach(() => {
        if (originalWindow === undefined) {
            delete (globalThis as { window?: unknown }).window;
        } else {
            setWindow(originalWindow);
        }
    });

    it("forwards to the Electron bridge when present", () => {
        const notify = vi.fn();
        setWindow({ velaDesktop: { notify } });
        notifyDesktop("标题", "内容");
        expect(notify).toHaveBeenCalledWith("标题", "内容");
    });

    it("reads the bridge lazily from the current window", () => {
        const notify = vi.fn();
        setWindow({ velaDesktop: { notify } });
        notifyDesktop("a", "b");
        setWindow({});
        notifyDesktop("c", "d");
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it("is a silent no-op in a plain browser (no bridge)", () => {
        setWindow({});
        expect(() => notifyDesktop("t", "b")).not.toThrow();
    });

    it("is a silent no-op with no window at all (Node/tests)", () => {
        delete (globalThis as { window?: unknown }).window;
        expect(() => notifyDesktop("t", "b")).not.toThrow();
    });
});

describe("desktop notification wiring in dashboard.ts", () => {
    it("sends a native notification when an alert starts ringing", () => {
        expect(dashboardSource).toContain('import { notifyDesktop } from "./desktopBridge";');
        expect(dashboardSource).toContain('notifyDesktop(`${a.symbol} 告警`, message)');
    });

    it("sends native notifications on disconnect and recovery", () => {
        expect(dashboardSource).toContain('notifyDesktop("币安连接断开"');
        expect(dashboardSource).toContain('notifyDesktop("币安连接恢复"');
    });
});