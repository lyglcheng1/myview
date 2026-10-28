import { describe, it, expect } from "vitest";
import { layoutForSplit, SPLIT_LAYOUT_ID } from "../playground/splitLayout";

describe("layoutForSplit", () => {
    it("builds a vertical split: left 1×1 tall beside a right 2×2", () => {
        const def = layoutForSplit({
            direction: "vertical",
            primary: { rows: 1, cols: 1 },
            secondary: { rows: 2, cols: 2 },
        });
        expect(def.id).toBe(SPLIT_LAYOUT_ID);
        expect(def.cols).toEqual([1, 1, 1]);
        expect(def.rows).toEqual([1, 1]);
        expect(def.areas).toEqual(["c1 c2 c3", "c1 c4 c5"]);
        expect(def.cells).toEqual([
            { id: "c1", area: "c1" },
            { id: "c2", area: "c2" },
            { id: "c3", area: "c3" },
            { id: "c4", area: "c4" },
            { id: "c5", area: "c5" },
        ]);
    });

    it("builds a vertical split with two stacked left cells", () => {
        const def = layoutForSplit({
            direction: "vertical",
            primary: { rows: 2, cols: 1 },
            secondary: { rows: 2, cols: 2 },
        });
        expect(def.rows).toEqual([1, 1]);
        // Left column is numbered first (c1/c2 stacked), then the right 2×2.
        expect(def.areas).toEqual(["c1 c3 c4", "c2 c5 c6"]);
    });

    it("stretches the shorter side when row counts differ", () => {
        const def = layoutForSplit({
            direction: "vertical",
            primary: { rows: 2, cols: 1 },
            secondary: { rows: 1, cols: 1 },
        });
        expect(def.rows.length).toBe(2);
        // Right single cell spans both grid rows.
        expect(def.areas).toEqual(["c1 c3", "c2 c3"]);
    });

    it("builds a horizontal split: top 1×2 wide above a bottom 2×2", () => {
        const def = layoutForSplit({
            direction: "horizontal",
            primary: { rows: 1, cols: 2 },
            secondary: { rows: 2, cols: 2 },
        });
        expect(def.cols).toEqual([1, 1]);
        expect(def.rows).toEqual([1, 1, 1]);
        expect(def.areas).toEqual(["c1 c2", "c3 c4", "c5 c6"]);
    });

    it("stretches a narrow top region across the full width", () => {
        const def = layoutForSplit({
            direction: "horizontal",
            primary: { rows: 1, cols: 1 },
            secondary: { rows: 2, cols: 2 },
        });
        expect(def.cols.length).toBe(2);
        expect(def.areas).toEqual(["c1 c1", "c2 c3", "c4 c5"]);
    });

    it("clamps rows/cols into 1..4", () => {
        const def = layoutForSplit({
            direction: "vertical",
            primary: { rows: 0, cols: 9 },
            secondary: { rows: 5, cols: -1 },
        });
        // primary 1×4, secondary 4×1 → 4 grid rows × 5 grid cols, 8 cells.
        expect(def.rows.length).toBe(4);
        expect(def.cols.length).toBe(5);
        expect(def.cells.length).toBe(1 * 4 + 4 * 1);
    });

    it("never leaves empty grid areas", () => {
        const def = layoutForSplit({
            direction: "horizontal",
            primary: { rows: 3, cols: 1 },
            secondary: { rows: 1, cols: 4 },
        });
        expect(def.areas).toHaveLength(4);
        expect(def.areas!.every((row) => !row.includes("."))).toBe(true);
    });
});