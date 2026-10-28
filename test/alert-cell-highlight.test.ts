import { describe, it, expect } from "vitest";
import { RingSymbolCounter } from "../playground/alertCellHighlight";

describe("RingSymbolCounter", () => {
    it("add increments the per-symbol count", () => {
        const c = new RingSymbolCounter();
        c.add("BTCUSDT");
        c.add("BTCUSDT");
        expect(c.has("BTCUSDT")).toBe(true);
    });

    it("remove returns false while alerts remain and true on the last one", () => {
        const c = new RingSymbolCounter();
        c.add("BTCUSDT");
        c.add("BTCUSDT");
        expect(c.remove("BTCUSDT")).toBe(false);
        expect(c.has("BTCUSDT")).toBe(true);
        expect(c.remove("BTCUSDT")).toBe(true);
        expect(c.has("BTCUSDT")).toBe(false);
    });

    it("handles multiple symbols independently", () => {
        const c = new RingSymbolCounter();
        c.add("BTCUSDT");
        c.add("ETHUSDT");
        c.remove("ETHUSDT");
        expect(c.has("BTCUSDT")).toBe(true);
        expect(c.has("ETHUSDT")).toBe(false);
    });

    it("remove for an unknown symbol is safe and reports true", () => {
        const c = new RingSymbolCounter();
        expect(c.remove("SOLUSDT")).toBe(true);
        expect(c.has("SOLUSDT")).toBe(false);
    });
});