import { describe, expect, it } from "vitest";
import { emaSeries, lastBarAtOrBefore } from "../playground/htfEma";

describe("emaSeries", () => {
  it("seeds with an SMA after `length` bars, then recurses with alpha = 2/(length+1)", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = emaSeries(values, 3);
    // Fewer than `length` bars produce no value.
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    // At index 2 the SMA(1,2,3) seed lands.
    expect(out[2]).toBeCloseTo(2);
    // From there each bar is alpha * price + (1-alpha) * previous EMA.
    expect(out[3]).toBeCloseTo(3);
    expect(out[9]).toBeCloseTo(9);
  });

  it("keeps NaN for non-finite inputs but carries the seed across the gap", () => {
    const values = [1, 2, Number.NaN, 5, 6];
    const out = emaSeries(values, 2);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeCloseTo(1.5); // SMA(1,2)
    expect(out[2]).toBeNaN(); // the gap paints nothing
    // The recursion continues from the last finite seed after the gap.
    expect(out[3]).toBeCloseTo((2 / 3) * 5 + (1 / 3) * 1.5);
    expect(out[4]).toBeCloseTo((2 / 3) * 6 + (1 / 3) * out[3]!);
  });

  it("returns all NaNs when fewer than `length` values are available", () => {
    expect(emaSeries([], 5)).toEqual([]);
    expect(emaSeries([1, 2], 3)).toEqual([Number.NaN, Number.NaN]);
    expect(emaSeries([1, 2, 3], 0)).toEqual([Number.NaN, Number.NaN, Number.NaN]);
  });
});

describe("lastBarAtOrBefore", () => {
  const bars = [
    { time: 100, open: 1, high: 1, low: 1, close: 1 },
    { time: 200, open: 2, high: 2, low: 2, close: 2 },
    { time: 300, open: 3, high: 3, low: 3, close: 3 },
  ];

  it("returns the last HTF bar whose open time is at or before the query time", () => {
    expect(lastBarAtOrBefore(bars, 50)).toBe(-1);
    expect(lastBarAtOrBefore(bars, 100)).toBe(0);
    expect(lastBarAtOrBefore(bars, 150)).toBe(0);
    expect(lastBarAtOrBefore(bars, 200)).toBe(1);
    expect(lastBarAtOrBefore(bars, 299)).toBe(1);
    expect(lastBarAtOrBefore(bars, 300)).toBe(2);
    expect(lastBarAtOrBefore(bars, 999)).toBe(2);
  });

  it("returns -1 for an empty bar list", () => {
    expect(lastBarAtOrBefore([], 100)).toBe(-1);
  });
});