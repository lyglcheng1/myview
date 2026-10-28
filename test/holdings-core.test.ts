import { describe, expect, it } from "vitest";
import {
  baseSymbolOf,
  computeRow,
  computeTotals,
  formatMoney,
  formatPrice,
  formatProfitPct,
  formatQuantity,
  profitClass,
  type Holding,
} from "../playground/holdingsCore";

const holding: Holding = {
  id: "h1",
  symbol: "TRXUSDT",
  buyDate: "2024-01-01",
  quantity: 2,
  buyPrice: 100,
  remark: "",
};

describe("baseSymbolOf", () => {
  it("strips the USDT quote suffix", () => {
    expect(baseSymbolOf("TRXUSDT")).toBe("TRX");
    expect(baseSymbolOf("BTCUSDT")).toBe("BTC");
  });

  it("keeps USDT itself unchanged and handles lowercase input", () => {
    expect(baseSymbolOf("USDT")).toBe("USDT");
    expect(baseSymbolOf("btcusdt")).toBe("BTC");
  });

  it("returns symbols without a USDT suffix as-is", () => {
    expect(baseSymbolOf("BTC")).toBe("BTC");
    expect(baseSymbolOf("")).toBe("");
  });

  it("strips the perpetual-futures .P suffix before the USDT quote", () => {
    expect(baseSymbolOf("BTCUSDT.P")).toBe("BTC");
    expect(baseSymbolOf("ethusdt.p")).toBe("ETH");
    expect(baseSymbolOf("USDT.P")).toBe("USDT");
  });
});

describe("computeRow", () => {
  it("computes market values, profit and percent", () => {
    const row = computeRow(holding, 120);
    expect(row.buyMarketValue).toBe(200);
    expect(row.currentMarketValue).toBe(240);
    expect(row.profit).toBe(40);
    expect(row.profitPct).toBe(20);
  });

  it("handles a loss with a negative percent", () => {
    const row = computeRow(holding, 90);
    expect(row.currentMarketValue).toBe(180);
    expect(row.profit).toBe(-20);
    expect(row.profitPct).toBe(-10);
  });

  it("treats invalid or zero prices as zero value", () => {
    const row = computeRow(holding, Number.NaN);
    expect(row.currentPrice).toBe(0);
    expect(row.currentMarketValue).toBe(0);
    expect(row.profit).toBe(-200);
    const zero = computeRow(holding, 0);
    expect(zero.currentMarketValue).toBe(0);
  });
});

describe("computeTotals", () => {
  it("aggregates values and computes the overall percent", () => {
    const rows = [
      computeRow({ ...holding, id: "a", quantity: 1, buyPrice: 100 }, 200),
      computeRow({ ...holding, id: "b", quantity: 1, buyPrice: 200 }, 300),
    ];
    const totals = computeTotals(rows);
    expect(totals.buyMarketValue).toBe(300);
    expect(totals.currentMarketValue).toBe(500);
    expect(totals.profit).toBe(200);
    expect(totals.profitPct).toBeCloseTo(66.6667, 3);
  });

  it("returns zeros for an empty list", () => {
    const totals = computeTotals([]);
    expect(totals).toEqual({ buyMarketValue: 0, currentMarketValue: 0, profit: 0, profitPct: 0 });
  });
});

describe("formatQuantity / formatPrice", () => {
  it("keeps two decimals for quantities", () => {
    expect(formatQuantity(1.5)).toBe("1.50");
    expect(formatQuantity(0)).toBe("0.00");
  });

  it("keeps four decimals for prices", () => {
    expect(formatPrice(1234.5678)).toBe("1234.5678");
    expect(formatPrice(0)).toBe("0.0000");
  });
});

describe("formatMoney", () => {
  it("shows USDT values unchanged with the unit", () => {
    expect(formatMoney(100, "USDT", 7)).toBe("100.00 USDT");
  });

  it("multiplies by the rate for RMB and appends CNY", () => {
    expect(formatMoney(100, "RMB", 7)).toBe("700.00 CNY");
    expect(formatMoney(0, "RMB", 7)).toBe("0.00 CNY");
  });
});

describe("formatProfitPct", () => {
  it("formats positive and negative percents", () => {
    expect(formatProfitPct(12.345)).toBe("12.35%");
    expect(formatProfitPct(-5.67)).toBe("-5.67%");
  });

  it("renders an em dash for non-finite values", () => {
    expect(formatProfitPct(Number.NaN)).toBe("—");
    expect(formatProfitPct(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("profitClass", () => {
  it("maps positive to up, negative to down, zero to none", () => {
    expect(profitClass(1)).toBe("up");
    expect(profitClass(-1)).toBe("down");
    expect(profitClass(0)).toBe("");
  });
});