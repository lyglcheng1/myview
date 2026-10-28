import { describe, expect, it, vi } from "vitest";
import {
    createDashboardStorage,
    createMemoryBackend,
    DASHBOARD_KEYS,
    type StorageBackend,
    type SyncStorage,
} from "../playground/idbStorage";
import dashboardSource from "../playground/dashboard.ts?raw";
import alertSoundsSource from "../playground/alertSounds.ts?raw";
import holdingsSource from "../playground/holdings.ts?raw";

function memorySync(init: Record<string, string> = {}): SyncStorage & { data: Map<string, string> } {
    const data = new Map(Object.entries(init));
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            data.set(key, value);
        },
        removeItem: (key) => {
            data.delete(key);
        },
    };
}

async function flush(): Promise<void> {
    // Memory backend promises resolve on the microtask queue; a couple of turns
    // is enough for write-through put/delete to land.
    await Promise.resolve();
    await Promise.resolve();
}

describe("createDashboardStorage", () => {
    it("serves the sync mirror before hydration and the cache after", async () => {
        const sync = memorySync({ "vela-dashboard-alerts": "[1]" });
        const backend = createMemoryBackend();
        const storage = createDashboardStorage({ backend, localStorage: sync });
        expect(storage.getItem("vela-dashboard-alerts")).toBe("[1]");
        await storage.ready;
        expect(storage.getItem("vela-dashboard-alerts")).toBe("[1]");
    });

    it("migrates the sync mirror into the backend on hydration", async () => {
        const sync = memorySync({ "vela-dashboard-alerts": "[1]" });
        const backend = createMemoryBackend();
        const storage = createDashboardStorage({ backend, localStorage: sync });
        await storage.ready;
        expect(await backend.get("vela-dashboard-alerts")).toBe("[1]");
        expect(storage.getItem("vela-dashboard-alerts")).toBe("[1]");
    });

    it("restores the sync mirror from IndexedDB when the mirror was cleared", async () => {
        const sync = memorySync();
        const backend = createMemoryBackend();
        await backend.put("vela-dashboard-alerts", "[2]");
        const storage = createDashboardStorage({ backend, localStorage: sync });
        await storage.ready;
        expect(sync.getItem("vela-dashboard-alerts")).toBe("[2]");
        expect(storage.getItem("vela-dashboard-alerts")).toBe("[2]");
    });

    it("migrates every known dashboard key present in the mirror", async () => {
        const sync = memorySync();
        for (const [i, key] of DASHBOARD_KEYS.entries()) {
            sync.setItem(key, `v${i}`);
        }
        const backend = createMemoryBackend();
        const storage = createDashboardStorage({ backend, localStorage: sync });
        await storage.ready;
        for (const [i, key] of DASHBOARD_KEYS.entries()) {
            expect(await backend.get(key)).toBe(`v${i}`);
            expect(storage.getItem(key)).toBe(`v${i}`);
        }
    });

    it("writes through to the backend on setItem and removeItem", async () => {
        const sync = memorySync();
        const backend = createMemoryBackend();
        const storage = createDashboardStorage({ backend, localStorage: sync });
        storage.setItem("vela-dashboard-theme", "light");
        expect(sync.getItem("vela-dashboard-theme")).toBe("light");
        await vi.waitFor(async () => {
            expect(await backend.get("vela-dashboard-theme")).toBe("light");
        });
        storage.removeItem("vela-dashboard-theme");
        expect(sync.getItem("vela-dashboard-theme")).toBeNull();
        await vi.waitFor(async () => {
            expect(await backend.get("vela-dashboard-theme")).toBeNull();
        });
    });

    it("fires onHydrated once hydration completes, and immediately if already hydrated", async () => {
        const sync = memorySync({ "vela-dashboard-theme": "dark" });
        const storage = createDashboardStorage({
            backend: createMemoryBackend(),
            localStorage: sync,
        });
        const callback = vi.fn();
        storage.onHydrated(callback);
        expect(callback).not.toHaveBeenCalled();
        await storage.ready;
        expect(callback).toHaveBeenCalledTimes(1);

        const late = vi.fn();
        storage.onHydrated(late);
        expect(late).toHaveBeenCalledTimes(1);
    });

    it("keeps working when the backend fails (IndexedDB unavailable)", async () => {
        const sync = memorySync({ "vela-dashboard-alerts": "[1]" });
        const failingBackend: StorageBackend = {
            get: async () => {
                throw new Error("no idb");
            },
            put: async () => {
                throw new Error("no idb");
            },
            delete: async () => {
                throw new Error("no idb");
            },
            getAll: async () => {
                throw new Error("no idb");
            },
        };
        const storage = createDashboardStorage({ backend: failingBackend, localStorage: sync });
        await storage.ready;
        expect(storage.getItem("vela-dashboard-alerts")).toBe("[1]");
        storage.setItem("vela-dashboard-theme", "dark");
        expect(storage.getItem("vela-dashboard-theme")).toBe("dark");
    });

    it("does not crash when a non-dashboard key is read or written", async () => {
        const storage = createDashboardStorage({
            backend: createMemoryBackend(),
            localStorage: memorySync(),
        });
        expect(storage.getItem("unrelated-key")).toBeNull();
        storage.setItem("unrelated-key", "x");
        await flush();
        expect(storage.getItem("unrelated-key")).toBe("x");
    });
});

describe("IndexedDB migration wiring in the dashboard sources", () => {
    it("routes dashboard persistence through the IndexedDB-backed storage", () => {
        expect(dashboardSource).toContain('import { dashboardStorage } from "./idbStorage";');
        expect(dashboardSource).toContain("dashboardStorage.getItem(WATCHLIST_KEY)");
        expect(dashboardSource).toContain("dashboardStorage.getItem(ALERTS_KEY)");
        expect(dashboardSource).toContain("dashboardStorage.setItem(PINE_KEY, JSON.stringify(pineScripts))");
    });

    it("reloads persisted models after hydration", () => {
        expect(dashboardSource).toContain("dashboardStorage.onHydrated(() => {");
        expect(dashboardSource).toContain("reloadHoldingsData()");
    });

    it("routes alert sound settings and holdings through the shared storage", () => {
        expect(alertSoundsSource).toContain('import { dashboardStorage } from "./idbStorage";');
        expect(alertSoundsSource).toContain("dashboardStorage.getItem(ALERT_SOUNDS_KEY)");
        expect(holdingsSource).toContain("dashboardStorage.getItem(HOLDINGS_KEY)");
        expect(holdingsSource).toContain("dashboardStorage.setItem(SPLIT_KEY, String(clamped))");
    });
});