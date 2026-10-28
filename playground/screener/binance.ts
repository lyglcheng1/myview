// Binance data source for the Pine coin screener.
//
// Provides the full Binance USDT spot pair list and per-coin daily K-lines by
// reusing Vela's BinanceProvider (public seam — it already handles kline
// pagination past Binance's 1000-row cap and the `api.binance.com` →
// `api.binance.us` endpoint fallback). The screener layers an incremental
// IndexedDB cache on top: on first contact a coin's daily history is
// downloaded and stored; later scans only fetch the bars missing since the
// last cached bar (`design: 历史数据全量下载后增量补缺`, docs/plans/pine-scripting.md).

import { BinanceProvider } from "../../src/data/providers/binance";
import type { OHLCV } from "../../src";
import { baseSymbolOf } from "../holdingsCore";
import type { KlineStore, ScanMarket, ScanStock, ScreenerDataSource, KlineSyncResult } from "./types";

const DAY_MS = 24 * 3_600_000;
/** Full-history lookback: Binance launched in 2017 — 10 years covers every daily bar. */
export const FULL_HISTORY_LOOKBACK_MS = 10 * 366 * DAY_MS;

/** Options for {@link createScreenerDataSource}. */
export interface BinanceDataSourceOptions {
    /** How many daily bars each coin should keep in the local cache (bounded mode). */
    historyBars: number;
    /** K-line cache (IndexedDB in the browser). */
    store: KlineStore;
    /** Which Binance market(s) to scan. Defaults to `"spot"` (USDT spot pairs). */
    market?: ScanMarket;
    /** When true, first contact downloads the coin's ENTIRE daily history. */
    fullHistory?: boolean;
    /** Injectable clock (tests). Defaults to `Date.now`. */
    now?: () => number;
    /** Injectable symbol lister (tests). Defaults to `BinanceProvider.listSymbols()`. */
    listSymbols?: () => Promise<Array<{ ticker: string; type: string }>>;
    /** Injectable daily-bar fetcher (tests). Defaults to `BinanceProvider.getBars(ticker, "D", …)`. */
    fetchKlines?: (ticker: string, fromMs: number, toMs: number) => Promise<OHLCV[]>;
}

/** True for a USDT spot pair (`BTCUSDT`). */
function isUsdtSpot(s: { ticker: string; type?: string }): boolean {
    return s.type === "crypto" && /USDT$/.test(s.ticker);
}

/** True for a USDT-margined perpetual future (`BTCUSDT.P`). */
function isUsdtFutures(s: { ticker: string; type?: string }): boolean {
    return s.type === "futures" && /USDT\.P$/.test(s.ticker);
}

/** Apply the market selector to one symbol descriptor. */
function matchesMarket(s: { ticker: string; type?: string }, market: ScanMarket): boolean {
    if (market === "futures") return isUsdtFutures(s);
    if (market === "all") return isUsdtSpot(s) || isUsdtFutures(s);
    return isUsdtSpot(s);
}

/** Build the screener's data source: USDT spot universe + incremental daily cache. */
export function createScreenerDataSource(options: BinanceDataSourceOptions): ScreenerDataSource {
    const historyBars = Math.max(30, Math.floor(options.historyBars));
    const now = options.now ?? Date.now;
    const binance = new BinanceProvider();
    const listSymbols = options.listSymbols ?? (() => binance.listSymbols());
    const fetchKlines =
        options.fetchKlines ?? ((ticker, fromMs, toMs) => binance.getBars(ticker, "D", { from: fromMs, to: toMs }));

    async function listStocks(): Promise<ScanStock[]> {
        const symbols = await listSymbols();
        // Only the selected market's USDT pairs: spot (`type === "crypto"`, ticker
        // ends in `USDT`) and/or USDT-margined perpetual futures (`type ===
        // "futures"`, ticker ends in `USDT.P`). (To also exclude stablecoin bases —
        // USDC/FDUSD/TUSD/DAI etc. — add a STABLECOINS set and skip symbols whose
        // base asset is in it.)
        const market = options.market ?? "spot";
        return symbols
            .filter((s) => matchesMarket(s, market))
            .map((s) => ({ ticker: s.ticker, name: baseSymbolOf(s.ticker) }));
    }

    /** Return cached bars, fetching only the missing tail when stale. */
    async function syncBars(stock: ScanStock): Promise<KlineSyncResult> {
        const to = now();
        const cached = await options.store.getBars(stock.ticker);
        if (cached && cached.length > 0) {
            const lastTime = cached[cached.length - 1]!.time;
            // Cache already covers today — nothing to download.
            if (to - lastTime < DAY_MS) return { bars: cached, cached: true, updated: false };
            const fresh = await fetchKlines(stock.ticker, lastTime + 1, to);
            if (!fresh.length) return { bars: cached, cached: false, updated: false };
            const merged = dedupeSorted([...cached, ...fresh]);
            const limited = options.fullHistory ? merged : merged.slice(-historyBars);
            await options.store.saveBars(stock.ticker, limited);
            return { bars: limited, cached: false, updated: true };
        }
        // First contact: either the whole market history (fullHistory) or a window
        // large enough to yield `historyBars` daily bars (crypto trades every day,
        // so 1.5× calendar days per bar + a 7-day buffer is conservative).
        const lookbackMs = options.fullHistory
            ? FULL_HISTORY_LOOKBACK_MS
            : Math.ceil(historyBars * 1.5) * DAY_MS + DAY_MS * 7;
        const bars = dedupeSorted(await fetchKlines(stock.ticker, to - lookbackMs, to));
        const limited = options.fullHistory ? bars : bars.slice(-historyBars);
        if (limited.length) await options.store.saveBars(stock.ticker, limited);
        return { bars: limited, cached: false, updated: limited.length > 0 };
    }

    return {
        async listStocks() {
            return listStocks();
        },
        async getBars(stock) {
            return (await syncBars(stock)).bars;
        },
        async syncBars(stock) {
            return syncBars(stock);
        },
    };
}

/** Sort by time and drop duplicate timestamps (Binance responses are ordered). */
function dedupeSorted(bars: OHLCV[]): OHLCV[] {
    const sorted = [...bars].sort((a, b) => a.time - b.time);
    const seen = new Set<number>();
    return sorted.filter((b) => (seen.has(b.time) ? false : (seen.add(b.time), true)));
}