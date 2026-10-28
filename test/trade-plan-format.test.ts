import { describe, expect, it } from "vitest";
import {
    formatDateStamp,
    formatPlanId,
    formatPlanTimestamp,
    sanitizePlanName,
    uniquePlanId,
} from "../playground/tradePlan/format";

describe("trade plan id formatting", () => {
    it("formats a YYYYMMDD date stamp", () => {
        expect(formatDateStamp(new Date(2026, 9, 26))).toBe("20261026");
    });

    it("builds `YYYYMMDD-ticker-name` plan ids", () => {
        expect(formatPlanId(new Date(2026, 9, 26), "BTCUSDT", "BTC")).toBe(
            "20261026-BTCUSDT-BTC",
        );
    });

    it("falls back to a ticker-only id when the name is empty", () => {
        expect(formatPlanId(new Date(2026, 9, 26), "BTCUSDT", "")).toBe("20261026-BTCUSDT");
    });

    it("sanitizes illegal filename characters and whitespace", () => {
        expect(sanitizePlanName("BTC/USDT:测试*?")).toBe("BTCUSDT测试");
        expect(sanitizePlanName("  BTC  ")).toBe("BTC");
    });

    it("appends -2 / -3 suffixes for same-day duplicates", () => {
        const base = "20261026-BTCUSDT-BTC";
        expect(uniquePlanId(base, [base])).toBe(`${base}-2`);
        expect(uniquePlanId(base, [base, `${base}-2`])).toBe(`${base}-3`);
    });

    it("returns the base id when it is unused", () => {
        expect(uniquePlanId("20261026-BTCUSDT-BTC", ["20261026-ETHUSDT-ETH"])).toBe(
            "20261026-BTCUSDT-BTC",
        );
    });

    it("formats human-readable timestamps", () => {
        const d = new Date(2026, 9, 26, 21, 5);
        expect(formatPlanTimestamp(d.getTime())).toBe("2026-10-26 21:05");
    });
});