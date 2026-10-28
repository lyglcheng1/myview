// Unit tests for the screener's Binance data source
// (`playground/screener/binance.ts`): the USDT-spot-only universe filter and
// the incremental daily-bar cache (first-contact window, tail merge, empty
// tail, full-history lookback) — all against injected fetchers, no network.

import { describe, expect, it } from "vitest";
import {
    createScreenerDataSource,
    FULL_HISTORY_LOOKBACK_MS,
} from "../playground/screener/binance";
import { createKlineStore, createMemoryKlineBackend } from "../playground/screener/klineStore";
import type { OHLCV } from "../src";

const DAY_MS = 24 * 3_600_000;

function bar(time: number): OHLCV {
    return { time, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

describe("createScreenerDataSource listStocks", () => {
    it("returns only USDT spot pairs (filters out futures and non-USDT quotes)", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const ds = createScreenerDataSource({
            historyBars: 100,
            store,
            listSymbols: async () => [
                { ticker: "BTCUSDT", type: "crypto" },
                { ticker: "ETHUSDT", type: "crypto" },
                { ticker: "BTCUSDT.P", type: "futures" },
                { ticker: "BTCEUR", type: "crypto" },
                { ticker: "USDCUSDT", type: "crypto" },
            ],
            fetchKlines: async () => [],
        });

        expect(await ds.listStocks()).toEqual([
            { ticker: "BTCUSDT", name: "BTC" },
            { ticker: "ETHUSDT", name: "ETH" },
            { ticker: "USDCUSDT", name: "USDC" },
        ]);
    });

    it("returns an empty list when there are no spot pairs", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const ds = createScreenerDataSource({
            historyBars: 100,
            store,
            listSymbols: async () => [{ ticker: "BTCUSDT.P", type: "futures" }],
            fetchKlines: async () => [],
        });

        expect(await ds.listStocks()).toEqual([]);
    });

    it("returns only USDT perpetual futures when market is futures", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const ds = createScreenerDataSource({
            historyBars: 100,
            market: "futures",
            store,
            listSymbols: async () => [
                { ticker: "BTCUSDT", type: "crypto" },
                { ticker: "BTCUSDT.P", type: "futures" },
                { ticker: "ETHUSDT.P", type: "futures" },
                { ticker: "BTCEUR.P", type: "futures" },
                { ticker: "BTCUSD_PERP.P", type: "futures" },
            ],
            fetchKlines: async () => [],
        });

        expect(await ds.listStocks()).toEqual([
            { ticker: "BTCUSDT.P", name: "BTC" },
            { ticker: "ETHUSDT.P", name: "ETH" },
        ]);
    });

    it("returns both spot and futures when market is all", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const ds = createScreenerDataSource({
            historyBars: 100,
            market: "all",
            store,
            listSymbols: async () => [
                { ticker: "BTCUSDT", type: "crypto" },
                { ticker: "BTCUSDT.P", type: "futures" },
                { ticker: "BTCEUR", type: "crypto" },
            ],
            fetchKlines: async () => [],
        });

        expect(await ds.listStocks()).toEqual([
            { ticker: "BTCUSDT", name: "BTC" },
            { ticker: "BTCUSDT.P", name: "BTC" },
        ]);
    });
});

describe("createScreenerDataSource cache sync", () => {
    it("downloads a bounded first-contact window and caches it", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const now = 1_000_000_000_000;
        const fetched: Array<[string, number, number]> = [];
        const ds = createScreenerDataSource({
            historyBars: 100,
            store,
            now: () => now,
            listSymbols: async () => [{ ticker: "BTCUSDT", type: "crypto" }],
            fetchKlines: async (ticker, from, to) => {
                fetched.push([ticker, from, to]);
                return [bar(to)];
            },
        });

        const bars = await ds.getBars({ ticker: "BTCUSDT", name: "BTC" });
        expect(bars).toHaveLength(1);
        const lookbackMs = Math.ceil(100 * 1.5) * DAY_MS + DAY_MS * 7;
        expect(fetched).toEqual([["BTCUSDT", now - lookbackMs, now]]);
        expect(await store.getBars("BTCUSDT")).toEqual(bars);
    });

    it("uses the full-history lookback when fullHistory is enabled", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const now = 1_000_000_000_000;
        const fetched: Array<[string, number, number]> = [];
        const ds = createScreenerDataSource({
            historyBars: 100,
            fullHistory: true,
            store,
            now: () => now,
            listSymbols: async () => [{ ticker: "BTCUSDT", type: "crypto" }],
            fetchKlines: async (ticker, from, to) => {
                fetched.push([ticker, from, to]);
                return [bar(to)];
            },
        });

        await ds.getBars({ ticker: "BTCUSDT", name: "BTC" });
        expect(fetched).toEqual([["BTCUSDT", now - FULL_HISTORY_LOOKBACK_MS, now]]);
    });

    it("trims the first-contact window to the configured historyBars", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const now = 1_000_000_000_000;
        const ds = createScreenerDataSource({
            historyBars: 50,
            store,
            now: () => now,
            listSymbols: async () => [{ ticker: "BTCUSDT", type: "crypto" }],
            fetchKlines: async (ticker, from, to) =>
                Array.from({ length: 100 }, (_, i) => bar(from + i)),
        });

        const bars = await ds.getBars({ ticker: "BTCUSDT", name: "BTC" });
        expect(bars).toHaveLength(50);
        expect(bars[0]!.time).toBeGreaterThan(0);
    });

    it("returns the cached bars without fetching when the cache is fresh", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const cached = [bar(100), bar(101)];
        await store.saveBars("BTCUSDT", cached);
        let fetched = 0;
        const ds = createScreenerDataSource({
            historyBars: 500,
            store,
            now: () => 101 + DAY_MS - 1, // less than one day after the last cached bar
            listSymbols: async () => [],
            fetchKlines: async () => {
                fetched += 1;
                return [];
            },
        });

        const result = await ds.syncBars({ ticker: "BTCUSDT", name: "BTC" });
        expect(result.cached).toBe(true);
        expect(result.updated).toBe(false);
        expect(result.bars).toEqual(cached);
        expect(fetched).toBe(0);
    });

    it("merges the missing tail into the cache when stale", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        await store.saveBars("BTCUSDT", [bar(100), bar(101)]);
        const now = 101 + DAY_MS + 1000;
        const ds = createScreenerDataSource({
            historyBars: 500,
            store,
            now: () => now,
            listSymbols: async () => [],
            fetchKlines: async (ticker, from) => [bar(from), bar(now)],
        });

        const result = await ds.syncBars({ ticker: "BTCUSDT", name: "BTC" });
        expect(result.cached).toBe(false);
        expect(result.updated).toBe(true);
        expect(result.bars.map((b) => b.time)).toEqual([100, 101, 102, now]);
        expect(await store.getBars("BTCUSDT")).toEqual(result.bars);
    });

    it("keeps the cache unchanged when the tail fetch returns nothing", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        const cached = [bar(100)];
        await store.saveBars("BTCUSDT", cached);
        let fetched = 0;
        const ds = createScreenerDataSource({
            historyBars: 500,
            store,
            now: () => 100 + DAY_MS + 1000,
            listSymbols: async () => [],
            fetchKlines: async () => {
                fetched += 1;
                return [];
            },
        });

        const result = await ds.syncBars({ ticker: "BTCUSDT", name: "BTC" });
        expect(result.cached).toBe(false);
        expect(result.updated).toBe(false);
        expect(result.bars).toEqual(cached);
        expect(fetched).toBe(1);
        expect(await store.getBars("BTCUSDT")).toEqual(cached);
    });
});