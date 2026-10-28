// IndexedDB-backed persistence for the dashboard's own user data.
//
// The dashboard page runs in two hosts — a plain browser (vite dev / static)
// and the Electron desktop app (desktop/). Both provide IndexedDB, so the
// dashboard persists its user data there (design: docs/plans/persistence.md)
// instead of relying on localStorage alone.
//
// Why the synchronous API? The dashboard initializes its models synchronously
// at module load (`let groups = loadGroups()`), while IndexedDB is async-only.
// This storage exposes the same getItem/setItem/removeItem surface as
// localStorage, backed by an in-memory cache:
//  - reads serve the cache once hydrated, and fall back to a synchronous
//    mirror (localStorage) otherwise — the mirror also acts as the migration
//    source on first run;
//  - writes go to the cache, the mirror AND IndexedDB (write-through);
//  - hydration reads IndexedDB into the cache and migrates mirror data up,
//    and restores the mirror when IndexedDB holds the only surviving copy.
// After hydration the cache is authoritative; `onHydrated` lets the host
// reload its models from the durable copy.
//
// The IndexedDB backend is injectable so the storage logic is unit-testable in
// Node (which has no IndexedDB): tests pass an in-memory backend.

/** Minimal async key/value backend — the real one is IndexedDB (see below). */
export interface StorageBackend {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    /** All records, key → value. Used for hydration and migration. */
    getAll(): Promise<Map<string, string>>;
}

/** The synchronous getItem/setItem/removeItem surface (like localStorage). */
export interface SyncStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface DashboardStorage extends SyncStorage {
    /** Resolves once IndexedDB has been read and the mirror migrated. */
    readonly ready: Promise<void>;
    /** Fired once, after hydration, so hosts can reload from the durable copy. */
    onHydrated(callback: () => void): void;
}

export interface DashboardStorageOptions {
    /** Async durable store. Defaults to IndexedDB (or memory when unavailable). */
    backend?: StorageBackend;
    /** Synchronous fallback/mirror. Defaults to `globalThis.localStorage`. */
    localStorage?: SyncStorage;
}

const DB_NAME = "vela-dashboard";
const DB_VERSION = 1;
const KV_STORE = "kv";

/** The dashboard's persisted keys (legacy localStorage keys, kept stable). */
export const DASHBOARD_KEYS = [
    "vela-dashboard-watchlist",
    "vela-dashboard-layouts",
    "vela-dashboard-alerts",
    "vela-dashboard-ema-config-v2",
    "vela-dashboard-pine-scripts",
    "vela-dashboard-theme",
    "vela-dashboard-alert-sort",
    "vela-dashboard-alert-sound",
    "vela-dashboard-alert-sound-custom",
    "vela-dashboard-holdings-v1",
    "vela-dashboard-holdings-rate-v1",
    "vela-dashboard-holdings-currency-v1",
    "vela-dashboard-holdings-split-v1",
] as const;

/** In-memory backend: used by tests and as the fallback when IndexedDB is absent. */
export function createMemoryBackend(): StorageBackend {
    const map = new Map<string, string>();
    return {
        get: async (key) => map.get(key) ?? null,
        put: async (key, value) => {
            map.set(key, value);
        },
        delete: async (key) => {
            map.delete(key);
        },
        getAll: async () => new Map(map),
    };
}

function openIndexedDb(idb: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = idb.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(KV_STORE)) {
                db.createObjectStore(KV_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
        req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
}

/** IndexedDB backend: database `vela-dashboard`, single `kv` object store. */
function createIndexedDbBackend(): StorageBackend {
    const idb = globalThis.indexedDB;
    if (!idb) return createMemoryBackend();
    let dbPromise: Promise<IDBDatabase> | null = null;
    const db = (): Promise<IDBDatabase> => (dbPromise ??= openIndexedDb(idb));

    return {
        get: async (key) => {
            const database = await db();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(KV_STORE, "readonly");
                const req = tx.objectStore(KV_STORE).get(key);
                req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
                req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
            });
        },
        put: async (key, value) => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(KV_STORE, "readwrite");
                tx.objectStore(KV_STORE).put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"));
            });
        },
        delete: async (key) => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(KV_STORE, "readwrite");
                tx.objectStore(KV_STORE).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
            });
        },
        getAll: async () => {
            const database = await db();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(KV_STORE, "readonly");
                const req = tx.objectStore(KV_STORE).openCursor();
                const map = new Map<string, string>();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (cursor) {
                        map.set(String(cursor.key), String(cursor.value));
                        cursor.continue();
                    } else {
                        resolve(map);
                    }
                };
                req.onerror = () => reject(req.error ?? new Error("IndexedDB getAll failed"));
            });
        },
    };
}

function defaultSyncStorage(): SyncStorage {
    const ls = (globalThis as { localStorage?: SyncStorage }).localStorage;
    if (ls) return ls;
    // Node / tests: in-memory fallback so importing this module never crashes.
    const mem = new Map<string, string>();
    return {
        getItem: (key) => mem.get(key) ?? null,
        setItem: (key, value) => {
            mem.set(key, value);
        },
        removeItem: (key) => {
            mem.delete(key);
        },
    };
}

/** Create a dashboard storage instance around an async backend + sync mirror. */
export function createDashboardStorage(options: DashboardStorageOptions = {}): DashboardStorage {
    const backend = options.backend ?? createIndexedDbBackend();
    const sync = options.localStorage ?? defaultSyncStorage();
    const cache = new Map<string, string>();
    const hydratedCallbacks: Array<() => void> = [];
    let hydrated = false;
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });

    function getItem(key: string): string | null {
        return cache.get(key) ?? sync.getItem(key);
    }

    function setItem(key: string, value: string): void {
        cache.set(key, value);
        try {
            sync.setItem(key, value);
        } catch {
            /* sync mirror unavailable → session cache only */
        }
        void backend.put(key, value).catch(() => {
            /* durable write failed → session cache + mirror still hold the value */
        });
    }

    function removeItem(key: string): void {
        cache.delete(key);
        try {
            sync.removeItem(key);
        } catch {
            /* ignore */
        }
        void backend.delete(key).catch(() => {
            /* durable delete failed → mirror still updated */
        });
    }

    function onHydrated(callback: () => void): void {
        if (hydrated) {
            callback();
            return;
        }
        hydratedCallbacks.push(callback);
    }

    async function hydrate(): Promise<void> {
        try {
            const stored = await backend.getAll();
            for (const key of DASHBOARD_KEYS) {
                const durable = stored.get(key);
                if (durable !== undefined) {
                    cache.set(key, durable);
                    // Restore the synchronous mirror so this boot's early reads
                    // (which happen before hydration) see the durable copy.
                    try {
                        if (sync.getItem(key) !== durable) sync.setItem(key, durable);
                    } catch {
                        /* mirror unavailable */
                    }
                } else {
                    const legacy = sync.getItem(key);
                    if (legacy !== null) {
                        cache.set(key, legacy);
                        await backend.put(key, legacy).catch(() => {
                            /* migration write failed → stays in the mirror */
                        });
                    }
                }
            }
        } catch {
            /* IndexedDB unavailable/corrupt → keep working off the mirror only */
        } finally {
            hydrated = true;
            resolveReady();
            const callbacks = hydratedCallbacks.splice(0);
            for (const callback of callbacks) {
                try {
                    callback();
                } catch {
                    /* host re-render failures must not reject hydration */
                }
            }
        }
    }

    void hydrate();

    return { getItem, setItem, removeItem, ready, onHydrated };
}

/** The dashboard-wide storage singleton. */
export const dashboardStorage: DashboardStorage = createDashboardStorage();