// Guards the dashboard's spot + USDT-M perpetual market helpers
// (`playground/binanceMarkets.ts`): `.P` ticker detection/formatting, the
// combined symbol list, and the REST URL / price-fetch logic used by alert
// polling. These are the pure functions behind the "合约数据源接入 UI" feature —
// search/watchlist/grid accept `BTCUSDT.P` alongside spot pairs.

import { describe, expect, it, vi } from "vitest";
import {
    displaySymbol,
    fetchLatestPrices,
    isPerpSymbol,
    klinesUrl,
    loadBinanceUsdtSymbols,
    toApiSymbol,
} from "../playground/binanceMarkets";

function fakeResponse(ok: boolean, body: unknown, status = ok ? 200 : 503): Response {
    return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe("binance market helpers", () => {
    it("detects and normalizes `.P` perpetual tickers", () => {
        expect(isPerpSymbol("BTCUSDT.P")).toBe(true);
        expect(isPerpSymbol("BTCUSDT")).toBe(false);
        expect(toApiSymbol("BTCUSDT.P")).toBe("BTCUSDT");
        expect(toApiSymbol("BTCUSDT")).toBe("BTCUSDT");
    });

    it("formats spot and perpetual symbols for the watchlist/search", () => {
        expect(displaySymbol("BTCUSDT")).toBe("BTC/USDT");
        expect(displaySymbol("ETHUSDT")).toBe("ETH/USDT");
        expect(displaySymbol("BTCUSDT.P")).toBe("BTC/USDT 永续");
        expect(displaySymbol("1000SATSUSDT.P")).toBe("1000SATS/USDT 永续");
    });

    it("merges spot and perpetual USDT pairs from both exchangeInfo endpoints", async () => {
        const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]) => {
            const url = input.toString();
            // Note: "fapi.binance.com" contains "api.binance.com" as a substring,
            // so the futures branch must be checked first.
            if (url.includes("fapi.binance.com")) {
                return Promise.resolve(fakeResponse(true, {
                    symbols: [
                        { symbol: "BTCUSDT", contractType: "PERPETUAL", quoteAsset: "USDT" },
                        { symbol: "ETHUSDT", contractType: "PERPETUAL", quoteAsset: "USDT" },
                        { symbol: "BTCUSDT", contractType: "CURRENT_QUARTER", quoteAsset: "USDT" }, // not perpetual
                        { symbol: "BTCUSDC", contractType: "PERPETUAL", quoteAsset: "USDC" }, // not USDT quote
                    ],
                }));
            }
            if (url.includes("api.binance.com")) {
                return Promise.resolve(fakeResponse(true, {
                    symbols: [
                        { symbol: "BTCUSDT" },
                        { symbol: "ETHUSDT" },
                        { symbol: "BTCUSDC" }, // not a USDT quote → excluded
                        { symbol: "USDCUSDT" },
                    ],
                }));
            }
            return Promise.resolve(fakeResponse(false, {}));
        });

        const list = await loadBinanceUsdtSymbols(fetchMock);
        expect(list).toEqual(["BTCUSDT", "BTCUSDT.P", "ETHUSDT", "ETHUSDT.P", "USDCUSDT"]);
    });

    it("keeps the healthy market when the other exchangeInfo fails", async () => {
        const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]) => {
            if (input.toString().includes("fapi.binance.com")) {
                return Promise.resolve(fakeResponse(true, { symbols: [{ symbol: "BTCUSDT", contractType: "PERPETUAL", quoteAsset: "USDT" }] }));
            }
            return Promise.resolve(fakeResponse(false, {}));
        });
        expect(await loadBinanceUsdtSymbols(fetchMock)).toEqual(["BTCUSDT.P"]);
    });

    it("returns an empty list when both markets are unreachable", async () => {
        const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(false, {})));
        expect(await loadBinanceUsdtSymbols(fetchMock)).toEqual([]);
    });

    it("routes alert klines to fapi for perpetuals and api for spot", () => {
        expect(klinesUrl("BTCUSDT", "5m")).toBe("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=2");
        expect(klinesUrl("BTCUSDT.P", "5m")).toBe("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=2");
    });

    it("fetches mixed spot/perp prices and keys perp results under the `.P` ticker", async () => {
        const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]) => {
            const url = input.toString();
            if (url.includes("fapi.binance.com")) {
                return Promise.resolve(fakeResponse(true, [{ symbol: "BTCUSDT", price: "60100" }]));
            }
            if (url.includes("api.binance.com")) {
                return Promise.resolve(fakeResponse(true, [{ symbol: "BTCUSDT", price: "60000" }]));
            }
            return Promise.resolve(fakeResponse(false, {}));
        });

        const prices = await fetchLatestPrices(["BTCUSDT", "BTCUSDT.P"], fetchMock);
        expect(prices.get("BTCUSDT")).toBe(60000);
        expect(prices.get("BTCUSDT.P")).toBe(60100);
    });

    it("ignores a failed price market instead of rejecting", async () => {
        const fetchMock = vi.fn(() => Promise.resolve(fakeResponse(false, {})));
        const prices = await fetchLatestPrices(["BTCUSDT", "BTCUSDT.P"], fetchMock);
        expect(prices.size).toBe(0);
    });
});