// Pine coin-screener scan engine.
//
// Runs a saved Pine script headlessly over the cached daily bars of every
// Binance USDT spot pair. The script must publish a boolean series via
// `plot(cond ? 1 : 0, "signal")`; a coin matches when the LAST bar's `signal`
// value is finite and nonzero. The engine is injected (the UI uses a
// worker-backed PineWorkerEngine) so the loop is unit-testable with fakes.

import type { ExecutionRequest, ExecutionSession, InputValue, OHLCV, PreparedScript } from "../../src";
import type { ScanProgress, ScanResult, ScanStock, ScreenerDataSource, ScreenerEngine } from "./types";

/** Default plot key the script must publish its boolean condition under. */
export const DEFAULT_SIGNAL_PLOT = "signal";
/** Bounded concurrency — fast enough, gentle on the Binance rate limit. */
export const SCAN_CONCURRENCY = 3;
/** Below this many bars a coin's signal is meaningless (warmup noise). */
const MIN_BARS = 30;

export interface RunScanOptions {
    /** Pine v5 source of the indicator/strategy to run. */
    source: string;
    /** Named plot whose last value is the boolean condition (default "signal"). */
    signalPlot?: string;
    /** Input overrides (script parameters). */
    inputs?: Record<string, InputValue>;
    /** Progress callback, fired after each processed coin. */
    onProgress: (p: ScanProgress) => void;
    /** Return true to request a cooperative cancellation. */
    shouldStop: () => boolean;
}

export interface ScanOutcome {
    results: ScanResult[];
    /** Number of coins in the scan universe. */
    total: number;
    phase: "done" | "cancelled" | "error";
    error?: string;
}

function changePctOf(bars: readonly OHLCV[]): number {
    if (bars.length < 2) return 0;
    const last = bars[bars.length - 1]?.close ?? 0;
    const prev = bars[bars.length - 2]?.close ?? 0;
    return prev !== 0 ? ((last - prev) / prev) * 100 : 0;
}

/** Run the prepared script once over `bars` and read the last signal value. */
function evaluateSignal(
    engine: ScreenerEngine,
    prepared: PreparedScript,
    stock: ScanStock,
    bars: readonly OHLCV[],
    inputs: Record<string, InputValue> | undefined,
    signalPlot: string,
): Promise<number | null> {
    return new Promise((resolve) => {
        let settled = false;
        let session: ExecutionSession | null = null;
        const finish = (value: number | null): void => {
            if (settled) return;
            settled = true;
            try {
                session?.stop();
            } catch {
                /* session already torn down */
            }
            resolve(value);
        };

        const request: ExecutionRequest = {
            prepared,
            // Vela's canonical daily timeframe key is "D" (1d).
            market: { symbol: stock.ticker, timeframe: "D" },
            bars: bars as OHLCV[],
            getBars: () => bars as OHLCV[],
            inputs,
            mode: "static",
            historyState: "complete",
        };

        session = engine.execute(request, {
            // The screener never attaches the script to a chart, so no model.
            onModel: () => {},
            onDone: () => {
                void (session?.getContext?.(["plots"]) ?? Promise.resolve(null))
                    .then((ctx) => {
                        const series = ctx?.plots?.[signalPlot];
                        const last = series && series.length ? series[series.length - 1] : undefined;
                        const value = last ? Number(last.value) : NaN;
                        finish(Number.isFinite(value) ? value : null);
                    })
                    .catch(() => finish(null));
            },
            onError: () => finish(null),
        });
    });
}

/** Scan the whole universe; returns matched coins and the terminal phase. */
export async function runScan(
    engine: ScreenerEngine,
    dataSource: ScreenerDataSource,
    options: RunScanOptions,
): Promise<ScanOutcome> {
    const signalPlot = options.signalPlot ?? DEFAULT_SIGNAL_PLOT;

    const emit = (p: ScanProgress): void => options.onProgress(p);

    emit({ phase: "preparing", total: 0, done: 0, matched: 0, currentTicker: "", currentName: "" });

    let prepared: PreparedScript;
    try {
        prepared = await engine.prepare(options.source, "pine-screener");
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        emit({ phase: "error", total: 0, done: 0, matched: 0, currentTicker: "", currentName: "", message: error });
        return { results: [], phase: "error", total: 0, error };
    }

    let stocks: ScanStock[];
    try {
        stocks = await dataSource.listStocks();
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        emit({ phase: "error", total: 0, done: 0, matched: 0, currentTicker: "", currentName: "", message: error });
        return { results: [], phase: "error", total: 0, error };
    }

    const total = stocks.length;
    const results: ScanResult[] = [];
    const queue = [...stocks];
    let done = 0;

    const report = (phase: "scanning" | "done" | "cancelled", current?: ScanStock): void => {
        emit({
            phase,
            total,
            done,
            matched: results.length,
            currentTicker: current?.ticker ?? "",
            currentName: current?.name ?? "",
        });
    };

    const workers = Array.from({ length: SCAN_CONCURRENCY }, async () => {
        while (!options.shouldStop()) {
            const stock = queue.shift();
            if (!stock) break;
            done += 1;
            report("scanning", stock);
            try {
                const bars = await dataSource.getBars(stock);
                if (bars.length >= MIN_BARS) {
                    const signal = await evaluateSignal(engine, prepared, stock, bars, options.inputs, signalPlot);
                    if (signal !== null && signal !== 0) {
                        results.push({
                            ticker: stock.ticker,
                            name: stock.name,
                            price: bars[bars.length - 1]?.close ?? 0,
                            changePct: changePctOf(bars),
                            signal,
                        });
                    }
                }
            } catch (e) {
                // A single coin must never abort the whole scan.
                console.warn(`[pine-screener] scan failed for ${stock.ticker} —`, e);
            }
        }
    });

    await Promise.all(workers);

    if (options.shouldStop()) {
        report("cancelled");
        return { results, phase: "cancelled", total };
    }
    report("done");
    return { results, phase: "done", total };
}