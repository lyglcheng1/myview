// Durable per-coin daily K-line cache for the Pine screener.
//
// Each coin's daily bars are stored as one compact record
// (`[time, o, h, l, c, v]` tuples) in a dedicated IndexedDB database
// (`vela-dashboard-kline`, separate from the dashboard's `vela-dashboard` kv
// store so the two never fight over schema versions). The backend is
// injectable so unit tests run against an in-memory map.

import type { OHLCV } from "../../src";
import type { KlineBackend, KlineStore } from "./types";

const DB_NAME = "vela-dashboard-kline";
const DB_VERSION = 1;
const STORE = "daily";

/** Compact on-disk bar shape: `[time, open, high, low, close, volume]`. */
type BarTuple = [number, number, number, number, number, number];

function toTuples(bars: readonly OHLCV[]): BarTuple[] {
    return bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume ?? 0] as BarTuple);
}

function toBars(tuples: readonly BarTuple[]): OHLCV[] {
    return tuples.map(([time, open, high, low, close, volume]) => ({
        time,
        open,
        high,
        low,
        close,
        volume,
    }));
}

/** In-memory backend — used by unit tests and when IndexedDB is unavailable. */
export function createMemoryKlineBackend(): KlineBackend {
    const map = new Map<string, unknown>();
    return {
        get: async (key) => map.get(key),
        put: async (key, value) => {
            map.set(key, value);
        },
        keys: async () => [...map.keys()],
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

/** IndexedDB backend: database `vela-dashboard-kline`, object store `daily`. */
export function createIndexedDbKlineBackend(): KlineBackend {
    if (typeof indexedDB === "undefined") return createMemoryKlineBackend();
    let dbPromise: Promise<IDBDatabase> | null = null;
    const db = (): Promise<IDBDatabase> => (dbPromise ??= openDb());

    return {
        get: async (key) => {
            const database = await db();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, "readonly");
                const req = tx.objectStore(STORE).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error ?? new Error("IndexedDB kline get failed"));
            });
        },
        put: async (key, value) => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(STORE, "readwrite");
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB kline put failed"));
            });
        },
        keys: async () => {
            const database = await db();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, "readonly");
                const req = tx.objectStore(STORE).getAllKeys();
                req.onsuccess = () => resolve(req.result as string[]);
                req.onerror = () => reject(req.error ?? new Error("IndexedDB kline keys failed"));
            });
        },
        clear: async () => {
            const database = await db();
            await new Promise<void>((resolve, reject) => {
                const tx = database.transaction(STORE, "readwrite");
                tx.objectStore(STORE).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB kline clear failed"));
            });
        },
    };
}

/** Create the screener's K-line cache over the given backend. */
export function createKlineStore(backend?: KlineBackend): KlineStore {
    const effective = backend ?? createIndexedDbKlineBackend();
    return {
        async getBars(ticker) {
            const raw = await effective.get(ticker);
            if (!raw) return null;
            const bars = (raw as { bars?: BarTuple[] }).bars;
            return bars?.length ? toBars(bars) : null;
        },
        async saveBars(ticker, bars) {
            await effective.put(ticker, { ticker, bars: toTuples(bars) });
        },
        async count() {
            return (await effective.keys()).length;
        },
        async clear() {
            await effective.clear();
        },
    };
}