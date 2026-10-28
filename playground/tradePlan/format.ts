// Trade-plan id formatting and name sanitization.
//
// Plan ids follow the fixed convention `YYYYMMDD-ticker-name` (e.g.
// `20261026-BTCUSDT-BTC`). Same-day duplicates get a numeric `-2` / `-3`
// suffix. Kept DOM-free so the naming logic is unit-testable in Node.

import type { TradePlan } from "./types";

/** Characters that break a file-name-like id (Windows-reserved + whitespace). */
const ILLEGAL_CHARS = /[\\/:*?"<>|\s]+/g;

/** Strip characters that are unsafe in a plan id. */
export function sanitizePlanName(name: string): string {
    return name.replace(ILLEGAL_CHARS, "").trim();
}

/** `YYYYMMDD` from a date (local time, matching the dashboard's clock). */
export function formatDateStamp(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
}

/** Build the base plan id: `YYYYMMDD-ticker-name`. */
export function formatPlanId(date: Date, ticker: string, name: string): string {
    const clean = sanitizePlanName(name);
    return `${formatDateStamp(date)}-${ticker}${clean ? `-${clean}` : ""}`;
}

/**
 * Ensure `id` is unique among existing plans: if taken, append `-2`, `-3`, …
 * (the base id itself is checked first).
 */
export function uniquePlanId(baseId: string, existing: readonly string[]): string {
    const taken = new Set(existing);
    if (!taken.has(baseId)) return baseId;
    let suffix = 2;
    while (taken.has(`${baseId}-${suffix}`)) suffix += 1;
    return `${baseId}-${suffix}`;
}

/** Human-readable `YYYY-MM-DD HH:mm` timestamp for plan cards. */
export function formatPlanTimestamp(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}`;
}

/** Short `code 名称` label used on plan cards and editor headers. */
export function formatPlanStockLabel(plan: TradePlan): string {
    return `${plan.ticker} ${plan.name}`;
}