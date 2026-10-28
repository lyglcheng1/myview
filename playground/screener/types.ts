/** Shared types for the Pine coin screener feature. */

import type {
    ExecutionHandlers,
    ExecutionRequest,
    ExecutionSession,
    InputValue,
    OHLCV,
    PreparedScript,
} from "../../src";

/** One Binance USDT spot pair in the scan universe (from exchangeInfo). */
export interface ScanStock {
    /** Binance spot pair, e.g. `BTCUSDT` (or `BTCUSDT.P` for a perpetual future). */
    ticker: string;
    /** Coin name, e.g. `BTC` (the ticker's base asset). */
    name: string;
}

/** Market universe selector for a screener run. */
export type ScanMarket = "spot" | "futures" | "all";

/** A coin whose Pine signal fired on the last daily bar. */
export interface ScanResult {
    ticker: string;
    name: string;
    /** Latest close (the last cached daily bar). */
    price: number;
    /** Day-over-day change% of the latest close. */
    changePct: number;
    /** The script's signal value on the last bar (nonzero = match). */
    signal: number;
}

/** What a per-coin K-line cache refresh did. */
export interface KlineSyncResult {
    /** The coin's cached daily bars after the refresh. */
    bars: OHLCV[];
    /** True when the cache was already fresh — nothing was downloaded. */
    cached: boolean;
    /** True when missing bars were fetched and the cache was rewritten. */
    updated: boolean;
}

export type ScanPhase =
    | "preparing"
    | "listing"
    | "scanning"
    | "done"
    | "cancelled"
    | "error";

/** Progress snapshot emitted by the scan loop. */
export interface ScanProgress {
    phase: ScanPhase;
    /** Total coins in the universe. */
    total: number;
    /** Coins already processed. */
    done: number;
    /** Matched coins so far. */
    matched: number;
    currentTicker: string;
    currentName: string;
    /** Optional human-readable detail (e.g. an error message). */
    message?: string;
}

/** The Pine engine surface the scan loop needs (satisfied by PineWorkerEngine). */
export interface ScreenerEngine {
    prepare(source: string, instanceId: string): Promise<PreparedScript>;
    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession;
}

/** Supplies the scan universe and per-coin daily bars (network + cache). */
export interface ScreenerDataSource {
    listStocks(): Promise<ScanStock[]>;
    /** Return the coin's cached daily bars, syncing incrementally when stale. */
    getBars(stock: ScanStock): Promise<OHLCV[]>;
    /** Refresh one coin's cached bars, reporting whether anything was fetched. */
    syncBars(stock: ScanStock): Promise<KlineSyncResult>;
}

/** Durable per-coin daily-bar cache (IndexedDB in the browser). */
export interface KlineStore {
    /** Cached daily bars for `ticker`, or null when nothing is cached yet. */
    getBars(ticker: string): Promise<OHLCV[] | null>;
    /** Replace the cached daily bars for `ticker`. */
    saveBars(ticker: string, bars: OHLCV[]): Promise<void>;
    /** How many coins currently have cached bars. */
    count(): Promise<number>;
    /** Wipe the whole K-line cache. */
    clear(): Promise<void>;
}

/** Minimal key/value backend behind {@link KlineStore} (injectable for tests). */
export interface KlineBackend {
    get(key: string): Promise<unknown | undefined>;
    put(key: string, value: unknown): Promise<void>;
    /** All keys currently stored. */
    keys(): Promise<string[]>;
    clear(): Promise<void>;
}