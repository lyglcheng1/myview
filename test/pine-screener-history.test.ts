// Unit tests for the Pine screener's durable scan-history helpers
// (`playground/screener/history.ts`): load/save, corruption tolerance,
// bounded history and per-id deletion.

import { describe, expect, it } from "vitest";
import {
    SCAN_HISTORY_KEY,
    SCAN_HISTORY_MAX,
    addScanToHistory,
    loadScanHistory,
    persistScanHistory,
    removeScanFromHistory,
} from "../playground/screener/history";
import type { SavedScan, ScanHistoryStorage } from "../playground/screener/history";

function createStorage(): { storage: ScanHistoryStorage; data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        storage: {
            getItem: (key) => data.get(key) ?? null,
            setItem: (key, value) => {
                data.set(key, value);
            },
        },
    };
}

function makeScan(overrides: Partial<SavedScan> = {}): SavedScan {
    return {
        id: "1",
        createdAt: 1700000000000,
        scriptId: "s1",
        scriptName: "EMA",
        historyBars: 500,
        inputs: { threshold: 0.0011 },
        market: "spot",
        total: 234,
        results: [{ ticker: "BTCUSDT", name: "BTC", price: 60000, changePct: 1.2, signal: 1 }],
        ...overrides,
    };
}

describe("pine screener scan history", () => {
    it("loads an empty list when nothing is stored", () => {
        const { storage } = createStorage();
        expect(loadScanHistory(storage)).toEqual([]);
    });

    it("tolerates corrupted JSON", () => {
        const { storage, data } = createStorage();
        data.set(SCAN_HISTORY_KEY, "{not json");
        expect(loadScanHistory(storage)).toEqual([]);
    });

    it("returns an empty list for non-array payloads", () => {
        const { storage, data } = createStorage();
        data.set(SCAN_HISTORY_KEY, JSON.stringify({ scans: [] }));
        expect(loadScanHistory(storage)).toEqual([]);
    });

    it("filters malformed entries", () => {
        const { storage, data } = createStorage();
        data.set(
            SCAN_HISTORY_KEY,
            JSON.stringify([
                makeScan(),
                { id: "no-results" },
                "garbage",
                null,
            ]),
        );
        const history = loadScanHistory(storage);
        expect(history).toHaveLength(1);
        expect(history[0]!.id).toBe("1");
    });

    it("round-trips through persist", () => {
        const { storage } = createStorage();
        const scan = makeScan({ id: "abc", createdAt: 123, results: [] });
        persistScanHistory(storage, [scan]);
        expect(loadScanHistory(storage)).toEqual([scan]);
    });

    it("caps the history at SCAN_HISTORY_MAX and drops the oldest", () => {
        let history: SavedScan[] = [];
        for (let i = 0; i < SCAN_HISTORY_MAX + 5; i++) {
            history = addScanToHistory(history, makeScan({ id: String(i), createdAt: i }));
        }
        expect(history).toHaveLength(SCAN_HISTORY_MAX);
        expect(history[0]!.id).toBe("5");
        expect(history[history.length - 1]!.id).toBe(String(SCAN_HISTORY_MAX + 4));
    });

    it("removes a scan by id and persists the result", () => {
        const { storage } = createStorage();
        const a = makeScan({ id: "a" });
        const b = makeScan({ id: "b" });
        persistScanHistory(storage, [a, b]);
        const history = removeScanFromHistory(loadScanHistory(storage), "a");
        expect(history.map((s) => s.id)).toEqual(["b"]);
        persistScanHistory(storage, history);
        expect(loadScanHistory(storage).map((s) => s.id)).toEqual(["b"]);
    });

    it("defaults legacy scans without a market field to spot", () => {
        const { storage, data } = createStorage();
        const scan = makeScan({ id: "legacy", results: [] });
        const { market: _market, ...legacy } = scan;
        data.set(SCAN_HISTORY_KEY, JSON.stringify([legacy]));

        const history = loadScanHistory(storage);
        expect(history).toHaveLength(1);
        expect(history[0]!.market).toBe("spot");
    });

    it("round-trips the market field through persist", () => {
        const { storage } = createStorage();
        const scan = makeScan({ id: "perp", market: "futures", results: [] });
        persistScanHistory(storage, [scan]);
        expect(loadScanHistory(storage)).toEqual([scan]);
    });
});