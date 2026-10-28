import { describe, it, expect } from "vitest";
import {
    alertConditionText,
    intervalForMinutes,
    migrateAlert,
    sortAlerts,
    surgePct,
    type Alert,
} from "../playground/alerts";

describe("intervalForMinutes", () => {
    it("maps supported windows to Binance kline intervals", () => {
        expect(intervalForMinutes(1)).toBe("1m");
        expect(intervalForMinutes(5)).toBe("5m");
        expect(intervalForMinutes(30)).toBe("30m");
        expect(intervalForMinutes(60)).toBe("1h");
        expect(intervalForMinutes(120)).toBe("1h");
    });
});

describe("surgePct", () => {
    it("computes percent change over the window", () => {
        expect(surgePct(100, 105)).toBe(5);
        expect(surgePct(100, 90)).toBe(-10);
        expect(surgePct(200, 220)).toBe(10);
    });

    it("returns NaN for a zero or invalid open price", () => {
        expect(Number.isNaN(surgePct(0, 10))).toBe(true);
        expect(Number.isNaN(surgePct(Number.NaN, 10))).toBe(true);
        expect(Number.isNaN(surgePct(100, Number.POSITIVE_INFINITY))).toBe(true);
    });
});

describe("alertConditionText", () => {
    const base = { id: "a1", symbol: "BTCUSDT", triggered: false, createdAt: 0 };

    it("renders price alerts", () => {
        expect(alertConditionText({ ...base, kind: "price-up", price: 65000 })).toBe("上穿 65000");
        expect(alertConditionText({ ...base, kind: "price-down", price: 60000 })).toBe("下穿 60000");
    });

    it("renders surge/dump alerts with window and threshold", () => {
        const surge: Alert = { ...base, kind: "surge", windowMinutes: 5, thresholdPct: 3 };
        const dump: Alert = { ...base, kind: "dump", windowMinutes: 15, thresholdPct: 2.5 };
        expect(alertConditionText(surge)).toBe("5分钟 爆拉 > 3%");
        expect(alertConditionText(dump)).toBe("15分钟 暴跌 > 2.5%");
    });
});

describe("sortAlerts", () => {
    const base = (symbol: string, n: number): Alert => ({
        id: `a_${n}`,
        symbol,
        triggered: false,
        createdAt: 0,
        kind: "price-up",
        price: 100,
    });

    it("keeps insertion order in default mode", () => {
        const list = [base("BTCUSDT", 1), base("ETHUSDT", 2), base("ADAUSDT", 3)];
        expect(sortAlerts(list, "default").map((a) => a.symbol)).toEqual([
            "BTCUSDT",
            "ETHUSDT",
            "ADAUSDT",
        ]);
    });

    it("sorts by symbol ascending and descending without mutating the input", () => {
        const list = [base("BTCUSDT", 1), base("ETHUSDT", 2), base("ADAUSDT", 3)];
        const asc = sortAlerts(list, "symbol-asc");
        const desc = sortAlerts(list, "symbol-desc");
        expect(asc.map((a) => a.symbol)).toEqual(["ADAUSDT", "BTCUSDT", "ETHUSDT"]);
        expect(desc.map((a) => a.symbol)).toEqual(["ETHUSDT", "BTCUSDT", "ADAUSDT"]);
        expect(list.map((a) => a.symbol)).toEqual(["BTCUSDT", "ETHUSDT", "ADAUSDT"]);
    });

    it("handles mixed-case symbols case-insensitively", () => {
        const list = [base("ETHUSDT", 1), base("btcusdt", 2)];
        expect(sortAlerts(list, "symbol-asc").map((a) => a.symbol)).toEqual(["btcusdt", "ETHUSDT"]);
    });
});

describe("migrateAlert", () => {
    it("migrates legacy price alerts without kind", () => {
        const migrated = migrateAlert({
            id: "a_1",
            symbol: "BTCUSDT",
            price: 65000,
            direction: "above",
            triggered: true,
        });
        expect(migrated).toEqual({
            id: "a_1",
            symbol: "BTCUSDT",
            triggered: true,
            createdAt: expect.any(Number),
            kind: "price-up",
            price: 65000,
        });
    });

    it("round-trips surge/dump alerts", () => {
        const migrated = migrateAlert({
            id: "s_1",
            symbol: "ETHUSDT",
            kind: "surge",
            windowMinutes: 5,
            thresholdPct: 4,
            triggered: false,
            createdAt: 123,
        });
        expect(migrated).toEqual({
            id: "s_1",
            symbol: "ETHUSDT",
            triggered: false,
            createdAt: 123,
            kind: "surge",
            windowMinutes: 5,
            thresholdPct: 4,
        });
    });

    it("rejects invalid or empty records", () => {
        expect(migrateAlert(null)).toBeNull();
        expect(migrateAlert("BTCUSDT")).toBeNull();
        expect(migrateAlert({ symbol: "", price: 1, direction: "above" })).toBeNull();
        expect(migrateAlert({ symbol: "BTCUSDT", price: -1, direction: "above" })).toBeNull();
    });
});