// Binance market helpers shared by the dashboard UI.
//
// The dashboard was built around USDT spot pairs (`BTCUSDT`). BinanceProvider
// already understands perpetual futures under the `.P` ticker suffix
// (`BTCUSDT.P` → fapi), so the search box, watchlist and K-line grid can treat
// them as first-class symbols. This module keeps the spot/perp distinctions in pure
// functions (unit-testable without a browser): display formatting, symbol-list
// loading over both exchangeInfo endpoints, and REST URLs for alert polling.

export const SPOT_EXCHANGE_INFO_URL = "https://api.binance.com/api/v3/exchangeInfo";
export const FUTURES_EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";
export const SPOT_TICKER_PRICE_URL = "https://api.binance.com/api/v3/ticker/price";
export const FUTURES_TICKER_PRICE_URL = "https://fapi.binance.com/fapi/v1/ticker/price";
export const SPOT_KLINES_URL = "https://api.binance.com/api/v3/klines";
export const FUTURES_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines";

/** True for a USDT-margined perpetual futures ticker (`BTCUSDT.P`). */
export function isPerpSymbol(symbol: string): boolean {
    return symbol.endsWith(".P");
}

/** Strip the `.P` futures suffix → the raw Binance API symbol (`BTCUSDT.P` → `BTCUSDT`). */
export function toApiSymbol(symbol: string): string {
    return isPerpSymbol(symbol) ? symbol.slice(0, -2) : symbol;
}

/** Human-readable watchlist/search label: `BTCUSDT` → `BTC/USDT`, `BTCUSDT.P` → `BTC/USDT 永续`. */
export function displaySymbol(symbol: string): string {
    const base = toApiSymbol(symbol);
    return `${base.replace("USDT", "/USDT")}${isPerpSymbol(symbol) ? " 永续" : ""}`;
}

/**
 * Load every tradeable USDT pair from both Binance markets: spot (`BTCUSDT`) and
 * USDT-margined perpetual futures (`BTCUSDT.P`). One failing market doesn't drop
 * the other; both failing yields an empty list (the caller keeps its fallback).
 */
export async function loadBinanceUsdtSymbols(fetchImpl: typeof fetch = fetch): Promise<string[]> {
    const [spotRes, futRes] = await Promise.all([
        fetchImpl(SPOT_EXCHANGE_INFO_URL).catch(() => null),
        fetchImpl(FUTURES_EXCHANGE_INFO_URL).catch(() => null),
    ]);
    const spot = await readSymbols(spotRes, (s) => s.symbol.endsWith("USDT"), (s) => s.symbol);
    const fut = await readSymbols(futRes, (s) => s.contractType === "PERPETUAL" && s.quoteAsset === "USDT", (s) => `${s.symbol}.P`);
    return [...new Set([...spot, ...fut])].sort();
}

/** Decode an exchangeInfo payload into ticker strings via the given filter/map. */
async function readSymbols(
    res: Response | null,
    keep: (s: { symbol: string; contractType?: string; quoteAsset?: string }) => boolean,
    map: (s: { symbol: string; contractType?: string; quoteAsset?: string }) => string,
): Promise<string[]> {
    if (!res?.ok) return [];
    try {
        const data = (await res.json()) as { symbols: { symbol: string; contractType?: string; quoteAsset?: string }[] };
        return (data.symbols ?? []).filter(keep).map(map);
    } catch {
        return [];
    }
}

/** REST klines URL for alert polling — futures pairs hit fapi, spot hits api. */
export function klinesUrl(symbol: string, interval: string): string {
    const base = isPerpSymbol(symbol) ? FUTURES_KLINES_URL : SPOT_KLINES_URL;
    return `${base}?symbol=${toApiSymbol(symbol)}&interval=${interval}&limit=2`;
}

/**
 * Fetch latest prices for a mixed spot/perp symbol list. Futures responses are
 * keyed back under the `.P` ticker, so callers can look up prices with the same
 * symbol the alert/watchlist uses. Unreachable markets simply contribute nothing.
 */
export async function fetchLatestPrices(
    symbols: string[],
    fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const unique = [...new Set(symbols)];
    const spot = unique.filter((s) => !isPerpSymbol(s));
    const perp = unique.filter(isPerpSymbol);
    const [spotRes, perpRes] = await Promise.all([
        spot.length
            ? fetchImpl(`${SPOT_TICKER_PRICE_URL}?symbols=${encodeURIComponent(JSON.stringify(spot))}`).catch(() => null)
            : Promise.resolve(null),
        perp.length
            ? fetchImpl(`${FUTURES_TICKER_PRICE_URL}?symbols=${encodeURIComponent(JSON.stringify(perp.map(toApiSymbol)))}`).catch(() => null)
            : Promise.resolve(null),
    ]);
    await ingestTickerPrices(prices, spotRes, false);
    await ingestTickerPrices(prices, perpRes, true);
    return prices;
}

/** Decode a ticker/price response into the shared map (perp keys regain `.P`). */
async function ingestTickerPrices(
    out: Map<string, number>,
    res: Response | null,
    perp: boolean,
): Promise<void> {
    if (!res?.ok) return;
    try {
        const data = (await res.json()) as { symbol?: string; price?: string }[];
        if (!Array.isArray(data)) return;
        for (const d of data) {
            if (typeof d.symbol !== "string" || d.price === undefined) continue;
            const key = perp ? `${d.symbol}.P` : d.symbol;
            const p = Number(d.price);
            if (Number.isFinite(p)) out.set(key, p);
        }
    } catch {
        /* non-JSON error body → ignore */
    }
}