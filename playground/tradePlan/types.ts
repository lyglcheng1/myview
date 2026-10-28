// Shared types for the trade-plan feature.

/** One saved trade plan (markdown body; images referenced via `vela-img://`). */
export interface TradePlan {
    /** Fixed plan id, e.g. `20261026-BTCUSDT-BTC` (or `-2` suffix for duplicates). */
    id: string;
    /** Epoch ms when the plan was created. */
    createdAt: number;
    /** Epoch ms of the last save. */
    updatedAt: number;
    /** Binance spot pair, e.g. `BTCUSDT`. */
    ticker: string;
    /** Coin name, e.g. `BTC`. */
    name: string;
    /** Markdown body (template sections + embedded images). */
    markdown: string;
}

/** Minimal key/value backend behind {@link TradePlanStore} (injectable for tests). */
export interface TradePlanBackend {
    get(key: string): Promise<unknown | undefined>;
    put(key: string, value: unknown): Promise<void>;
    /** All keys currently stored. */
    keys(): Promise<string[]>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

/** Durable trade-plan storage (IndexedDB in the browser). */
export interface TradePlanStore {
    /** All saved plans, newest first. */
    list(): Promise<TradePlan[]>;
    /** One plan by id, or null when missing. */
    get(id: string): Promise<TradePlan | null>;
    /** Insert or replace a plan (keyed by id). */
    save(plan: TradePlan): Promise<void>;
    /** Remove a plan by id. */
    remove(id: string): Promise<void>;
    /** Wipe all plans. */
    clear(): Promise<void>;
}

/** Minimal key/value backend behind the trade-plan image store (injectable). */
export interface ImageBackend {
    get(key: string): Promise<unknown | undefined>;
    put(key: string, value: unknown): Promise<void>;
    /** All keys currently stored. */
    keys(): Promise<string[]>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

/** Durable storage for chart-screenshot / pasted images referenced from plans. */
export interface ImageStore {
    /** Store a data URL and return a short reference id (`vela-img://<id>`). */
    save(dataUrl: string): Promise<string>;
    /** Resolve a reference id back to its data URL, or null when missing. */
    get(id: string): Promise<string | null>;
    /** Delete images by id (missing ids are ignored). */
    delete(ids: string[]): Promise<void>;
}