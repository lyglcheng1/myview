// Playground module: build asymmetric SPLIT layouts (left/right or top/bottom),
// where each region is its own rows×cols grid. Vela's layout registry already
// supports arbitrary `grid-template-areas` (see src/workspace/layouts.ts), so
// this generator only synthesizes the rectangular area map for the split — no
// library change, host code only.
//
// Semantics: the two regions share the whole grid. Along the split axis the
// taller/wider side defines the grid extent and the other side's cells STRETCH
// to fill it evenly (so "left 1×1" next to "right 2×2" is one tall left cell
// beside a 2×2 block — the classic asymmetric dashboard).
import type { LayoutDefinition } from "../src/workspace";

/** Region geometry for one side of a split layout. */
export interface SplitRegion {
    rows: number;
    cols: number;
}

/** A split layout request: direction + per-region rows×cols. */
export interface SplitLayoutOptions {
    direction: "vertical" | "horizontal";
    /** Left (vertical) or top (horizontal) region. */
    primary: SplitRegion;
    /** Right (vertical) or bottom (horizontal) region. */
    secondary: SplitRegion;
}

/** Stable registry id for the generated layout (re-registering replaces). */
export const SPLIT_LAYOUT_ID = "custom-split";

/** Per-region row/col bound — mirrors the workspace grid picker's 4×4 canvas. */
export const SPLIT_MAX = 4;

const clampRegion = (n: number): number => Math.max(1, Math.min(SPLIT_MAX, Math.round(n)));

const clamp = (r: SplitRegion): { rows: number; cols: number } => ({
    rows: clampRegion(r.rows),
    cols: clampRegion(r.cols),
});

/** How many grid tracks each of `n` cell-rows/cols covers, top/left aligned:
 *  `base = floor(extent / n)` and the first `extent % n` get one extra, so the
 *  spans always sum to `extent`. */
function spans(n: number, extent: number): number[] {
    const base = Math.floor(extent / n);
    const extra = extent % n;
    return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * A split layout where each side is its own rows×cols grid. Vertical splits
 * share `max(primary.rows, secondary.rows)` grid rows; horizontal splits share
 * `max(primary.cols, secondary.cols)` grid columns. Every grid track is covered
 * (no empty areas): a side with fewer tracks along the split axis stretches its
 * cells to fill the remaining extent.
 */
export function layoutForSplit(options: SplitLayoutOptions): LayoutDefinition {
    const primary = clamp(options.primary);
    const secondary = clamp(options.secondary);
    const vertical = options.direction === "vertical";

    const gridRows = vertical
        ? Math.max(primary.rows, secondary.rows)
        : primary.rows + secondary.rows;
    const gridCols = vertical
        ? primary.cols + secondary.cols
        : Math.max(primary.cols, secondary.cols);

    const areas: string[][] = Array.from({ length: gridRows }, () =>
        Array.from({ length: gridCols }, () => "."),
    );
    const cells: Array<{ id: string; area: string }> = [];
    let n = 0;

    const fillRegion = (
        rowOffset: number,
        colOffset: number,
        region: { rows: number; cols: number },
        axis: "rows" | "cols",
    ): void => {
        const extent = axis === "rows" ? gridRows : gridCols;
        const trackSpans = spans(axis === "rows" ? region.rows : region.cols, extent);
        if (axis === "rows") {
            let rowCursor = 0;
            for (let r = 0; r < region.rows; r += 1) {
                const span = trackSpans[r]!;
                for (let c = 0; c < region.cols; c += 1) {
                    const id = `c${++n}`;
                    cells.push({ id, area: id });
                    for (let gr = rowCursor; gr < rowCursor + span; gr += 1) {
                        const row = areas[gr]!;
                        row[colOffset + c] = id;
                    }
                }
                rowCursor += span;
            }
        } else {
            for (let r = 0; r < region.rows; r += 1) {
                let colCursor = 0;
                for (let c = 0; c < region.cols; c += 1) {
                    const span = trackSpans[c]!;
                    const id = `c${++n}`;
                    cells.push({ id, area: id });
                    for (let gc = colCursor; gc < colCursor + span; gc += 1) {
                        const row = areas[rowOffset + r]!;
                        row[gc] = id;
                    }
                    colCursor += span;
                }
            }
        }
    };

    if (vertical) {
        // Left region fills the leading `primary.cols` columns, right the rest.
        fillRegion(0, 0, primary, "rows");
        fillRegion(0, primary.cols, secondary, "rows");
    } else {
        // Top region fills the leading `primary.rows` grid rows, bottom the rest.
        fillRegion(0, 0, primary, "cols");
        fillRegion(primary.rows, 0, secondary, "cols");
    }

    return {
        id: SPLIT_LAYOUT_ID,
        label: `${vertical ? "左右" : "上下"}分栏 ${primary.rows}×${primary.cols} + ${secondary.rows}×${secondary.cols}`,
        cols: Array.from({ length: gridCols }, () => 1),
        rows: Array.from({ length: gridRows }, () => 1),
        areas: areas.map((row) => row.join(" ")),
        cells,
    };
}