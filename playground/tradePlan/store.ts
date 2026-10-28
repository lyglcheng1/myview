// Durable trade-plan storage.
//
// Plans (including embedded base64 chart screenshots) live in a dedicated
// IndexedDB database (`vela-dashboard-trade-plans`) so image-heavy markdown
// never hits the ~5MB localStorage mirror used by `dashboardStorage`. The
// backend is injectable so unit tests run against an in-memory map.

import type { TradePlan, TradePlanBackend, TradePlanStore } from "./types";

const DB_NAME = "vela-dashboard-trade-plans";
const DB_VERSION = 1;
const STORE = "plans";

/** In-memory backend — used by unit tests and when IndexedDB is unavailable. */
export function createMemoryTradePlanBackend(): TradePlanBackend {
    const map = new Map<string, unknown>();
    return {
        get: async (key) => map.get(key),
        put: async (key, value) => {
            map.set(key, value);
        },
        keys: async () => [...map.keys()],
        delete: async (key) => {
            map.delete(key);
        },
        clear: async () => {
            map.clear();
        },
    };
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error(`IndexedDB open failed (${DB_NAME})`));
        req.onblocked = () => reject(new Error(`IndexedDB open blocked (${DB_NAME})`));
    });
}

/** IndexedDB backend: database `vela-dashboard-trade-plans`, object store `plans`. */
export function createIndexedDbTradePlanBackend(): TradePlanBackend {
    if (typeof indexedDB === "undefined") return createMemoryTradePlanBackend();
    let dbPromise: Promise<IDBDatabase> | null = null;
    const db = (): Promise<IDBDatabase> => (dbPromise ??= openDb());

    return {
        get: async (key) => {
            const database = await db();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, "readonly");
                const req = tx.objectStore(STORE).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error ?? new Error("IndexedDB trade-plan get failed"));
            });
        },
        put: async (key, value) => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(STORE, "readwrite");
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB trade-plan put failed"));
            });
        },
        keys: async () => {
            const database = await db();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, "readonly");
                const req = tx.objectStore(STORE).getAllKeys();
                req.onsuccess = () => resolve(req.result as string[]);
                req.onerror = () => reject(req.error ?? new Error("IndexedDB trade-plan keys failed"));
            });
        },
        delete: async (key) => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(STORE, "readwrite");
                tx.objectStore(STORE).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB trade-plan delete failed"));
            });
        },
        clear: async () => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(STORE, "readwrite");
                tx.objectStore(STORE).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB trade-plan clear failed"));
            });
        },
    };
}

function isTradePlan(value: unknown): value is TradePlan {
    if (typeof value !== "object" || value === null) return false;
    const plan = value as TradePlan;
    return (
        typeof plan.id === "string" &&
        typeof plan.createdAt === "number" &&
        typeof plan.updatedAt === "number" &&
        typeof plan.ticker === "string" &&
        typeof plan.name === "string" &&
        typeof plan.markdown === "string"
    );
}

/** Create the trade-plan store over the given backend. */
export function createTradePlanStore(
    backend: TradePlanBackend = createIndexedDbTradePlanBackend(),
): TradePlanStore {
    return {
        async list() {
            const keys = await backend.keys();
            const plans: TradePlan[] = [];
            for (const key of keys) {
                const raw = await backend.get(key);
                if (isTradePlan(raw)) plans.push(raw);
            }
            return plans.sort((a, b) => b.updatedAt - a.updatedAt);
        },
        async get(id) {
            const raw = await backend.get(id);
            return isTradePlan(raw) ? raw : null;
        },
        async save(plan) {
            await backend.put(plan.id, plan);
        },
        async remove(id) {
            await backend.delete(id);
        },
        async clear() {
            await backend.clear();
        },
    };
}