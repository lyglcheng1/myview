import { describe, expect, it } from "vitest";
import { createKlineStore, createMemoryKlineBackend } from "../playground/screener/klineStore";

// Unit tests for the screener's K-line cache: the injectable in-memory backend
// and the compact `[time, o, h, l, c, v]` tuple round-trip through the store.

function bars() {
    return [
        { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 },
        { time: 2, open: 11, high: 13, low: 10, close: 12, volume: 120 },
    ];
}

describe("createMemoryKlineBackend", () => {
    it("stores, reads and lists keys, and clears", async () => {
        const backend = createMemoryKlineBackend();
        await backend.put("BTCUSDT", { bars: [1, 2, 3] });
        await backend.put("ETHUSDT", { bars: [4] });
        expect(await backend.get("BTCUSDT")).toEqual({ bars: [1, 2, 3] });
        expect(await backend.get("missing")).toBeUndefined();
        expect(await backend.keys()).toEqual(["BTCUSDT", "ETHUSDT"]);
        await backend.clear();
        expect(await backend.keys()).toEqual([]);
        expect(await backend.get("BTCUSDT")).toBeUndefined();
    });
});

describe("createKlineStore", () => {
    it("round-trips OHLCV bars through compact tuples", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        await store.saveBars("BTCUSDT", bars());
        const loaded = await store.getBars("BTCUSDT");
        expect(loaded).toEqual(bars());
        expect(loaded?.[1]?.volume).toBe(120);
    });

    it("returns null for an uncached ticker", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        expect(await store.getBars("none")).toBeNull();
    });

    it("counts cached stocks and wipes on clear", async () => {
        const store = createKlineStore(createMemoryKlineBackend());
        await store.saveBars("BTCUSDT", bars());
        await store.saveBars("ETHUSDT", bars());
        expect(await store.count()).toBe(2);
        await store.clear();
        expect(await store.count()).toBe(0);
        expect(await store.getBars("BTCUSDT")).toBeNull();
    });
});