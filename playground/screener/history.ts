// Durable scan-result history for the Pine coin screener.
//
// Every completed scan is persisted (with a timestamp) so results survive
// reloads and can be reviewed, re-run or deleted later. Kept DOM-free so the
// load/save/trim logic is unit-testable in Node.

import type { InputValue } from "../../src";
import type { ScanMarket, ScanResult } from "./types";

/** A completed scan persisted in the dashboard store. */
export interface SavedScan {
    /** Unique id (millisecond timestamp). */
    id: string;
    /** Epoch milliseconds when the scan finished. */
    createdAt: number;
    /** Id of the Pine script that produced these results. */
    scriptId: string;
    /** Human-readable script name for the history list. */
    scriptName: string;
    /** Number of daily bars used per coin. */
    historyBars: number;
    /** Script input values used for the scan. */
    inputs: Record<string, InputValue>;
    /** Market universe the scan ran over (`"spot"` | `"futures"` | `"all"`). */
    market: ScanMarket;
    /** Number of coins scanned. */
    total: number;
    /** Coins whose signal fired on the last bar. */
    results: ScanResult[];
}

/** Minimal synchronous key/value surface (satisfied by `dashboardStorage`). */
export interface ScanHistoryStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const SCAN_HISTORY_KEY = "vela-dashboard-pine-scan-history";
/** Keep the persisted list bounded; oldest scans are dropped first. */
export const SCAN_HISTORY_MAX = 20;

export function loadScanHistory(storage: ScanHistoryStorage): SavedScan[] {
    const raw = storage.getItem(SCAN_HISTORY_KEY);
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(
                (s): s is SavedScan =>
                    typeof s === "object" &&
                    s !== null &&
                    typeof (s as SavedScan).id === "string" &&
                    typeof (s as SavedScan).createdAt === "number" &&
                    typeof (s as SavedScan).scriptId === "string" &&
                    typeof (s as SavedScan).historyBars === "number" &&
                    Array.isArray((s as SavedScan).results),
            )
            .map((s) => ({ ...s, market: (s as { market?: ScanMarket }).market ?? "spot" }));
    } catch {
        /* corrupted history → start empty */
        return [];
    }
}

export function persistScanHistory(storage: ScanHistoryStorage, history: SavedScan[]): void {
    storage.setItem(SCAN_HISTORY_KEY, JSON.stringify(history));
}

/** Append a finished scan, dropping the oldest entry when over the cap. */
export function addScanToHistory(history: SavedScan[], scan: SavedScan): SavedScan[] {
    const next = [...history, scan];
    return next.length > SCAN_HISTORY_MAX ? next.slice(next.length - SCAN_HISTORY_MAX) : next;
}

/** Remove one saved scan by id. */
export function removeScanFromHistory(history: SavedScan[], id: string): SavedScan[] {
    return history.filter((s) => s.id !== id);
}