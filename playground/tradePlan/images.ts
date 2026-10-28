// Durable image store for trade plans.
//
// Chart screenshots and pasted images are large base64 strings that would bloat
// the markdown source if embedded directly. Instead the markdown keeps a short
// reference `![图](vela-img://<id>)` and the actual data URL lives in a
// dedicated IndexedDB database (`vela-dashboard-trade-plan-images`). The live
// preview and card thumbnails resolve the reference asynchronously. The
// backend is injectable so unit tests run against an in-memory map.

import type { ImageBackend, ImageStore } from "./types";

const DB_NAME = "vela-dashboard-trade-plan-images";
const DB_VERSION = 1;
const STORE = "images";

/** In-memory backend — used by unit tests and when IndexedDB is unavailable. */
export function createMemoryImageBackend(): ImageBackend {
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

function createImageId(): string {
    // Short collision-resistant id (≈12 chars) so the markdown stays compact.
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

/** IndexedDB backend: database `vela-dashboard-trade-plan-images`, store `images`. */
export function createIndexedDbImageBackend(): ImageBackend {
    if (typeof indexedDB === "undefined") return createMemoryImageBackend();
    let dbPromise: Promise<IDBDatabase> | null = null;
    const db = (): Promise<IDBDatabase> => (dbPromise ??= openDb());

    return {
        get: async (key) => {
            const database = await db();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, "readonly");
                const req = tx.objectStore(STORE).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error ?? new Error("IndexedDB trade-plan image get failed"));
            });
        },
        put: async (key, value) => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(STORE, "readwrite");
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB trade-plan image put failed"));
            });
        },
        keys: async () => {
            const database = await db();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, "readonly");
                const req = tx.objectStore(STORE).getAllKeys();
                req.onsuccess = () => resolve(req.result as string[]);
                req.onerror = () => reject(req.error ?? new Error("IndexedDB trade-plan image keys failed"));
            });
        },
        delete: async (key) => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(STORE, "readwrite");
                tx.objectStore(STORE).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB trade-plan image delete failed"));
            });
        },
        clear: async () => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(STORE, "readwrite");
                tx.objectStore(STORE).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB trade-plan image clear failed"));
            });
        },
    };
}

/** Create the trade-plan image store over the given backend. */
export function createImageStore(
    backend: ImageBackend = createIndexedDbImageBackend(),
): ImageStore {
    return {
        async save(dataUrl) {
            const id = createImageId();
            await backend.put(id, dataUrl);
            return id;
        },
        async get(id) {
            const raw = await backend.get(id);
            return typeof raw === "string" ? raw : null;
        },
        async delete(ids) {
            for (const id of ids) {
                await backend.delete(id);
            }
        },
    };
}

/** Extract every `vela-img://` reference id from markdown (deduplicated). */
export function extractImageIds(markdown: string): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const re = /!\[[^\]]*\]\(vela-img:\/\/([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
        const id = m[1]!.trim();
        if (id && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}