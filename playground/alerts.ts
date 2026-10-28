// Playground module: alert models + pure helpers shared by the dashboard's
// price-alert and surge/dump monitors (docs/plans/alerts.md). The polling
// itself lives in dashboard.ts; everything here is pure and unit-testable.

/** Base fields shared by every alert. */
export interface AlertBase {
    id: string;
    symbol: string;
    triggered: boolean;
    createdAt: number;
}

/** Price-threshold alert (target price, up or down). */
export interface PriceAlert extends AlertBase {
    kind: "price-up" | "price-down";
    price: number;
}

/** Surge/dump alert (windowed percent move). */
export interface SurgeAlert extends AlertBase {
    kind: "surge" | "dump";
    windowMinutes: number;
    thresholdPct: number;
}

/** Any persisted alert. */
export type Alert = PriceAlert | SurgeAlert;

/** Binance kline intervals offered as surge/dump windows. */
export const ALERT_WINDOW_MINUTES = [1, 3, 5, 15, 30, 60] as const;

/** Map a window in minutes to a Binance kline interval string. */
export function intervalForMinutes(minutes: number): string {
    if (minutes >= 60) return "1h";
    return `${minutes}m`;
}

/** Percent change over a window from its opening price (open/close from klines). */
export function surgePct(open: number, close: number): number {
    if (!Number.isFinite(open) || !Number.isFinite(close) || open === 0) return NaN;
    return ((close - open) / open) * 100;
}

/** Human-readable condition for an alert (used by the alert list). */
export function alertConditionText(a: Alert): string {
    if (a.kind === "price-up") return `上穿 ${a.price}`;
    if (a.kind === "price-down") return `下穿 ${a.price}`;
    if (a.kind === "surge" || a.kind === "dump") {
        const dir = a.kind === "surge" ? "爆拉" : "暴跌";
        return `${a.windowMinutes}分钟 ${dir} > ${a.thresholdPct}%`;
    }
    return "";
}

/** Sort orders offered by the unified alert management list. */
export type AlertSortMode = "default" | "symbol-asc" | "symbol-desc";

/**
 * Sort a copy of alerts by symbol (`localeCompare`), or keep the stored order
 * for "default". The original array is never mutated.
 */
export function sortAlerts(alerts: Alert[], mode: AlertSortMode): Alert[] {
    const copy = [...alerts];
    if (mode === "symbol-asc") copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else if (mode === "symbol-desc") copy.sort((a, b) => b.symbol.localeCompare(a.symbol));
    return copy;
}

/**
 * Normalize a persisted alert record into the current Alert shape. Legacy price
 * alerts stored `{ price, direction: "above"|"below" }` without `kind`; those
 * migrate to `price-up`/`price-down`. Unrecognized records return null.
 */
export function migrateAlert(raw: unknown): Alert | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const symbol = typeof obj.symbol === "string" ? obj.symbol.trim() : "";
    if (!symbol) return null;
    const base: AlertBase = {
        id: typeof obj.id === "string" ? obj.id : `a_${Date.now()}`,
        symbol,
        triggered: Boolean(obj.triggered),
        createdAt: typeof obj.createdAt === "number" ? obj.createdAt : Date.now(),
    };
    const kind = obj.kind;
    if (kind === "surge" || kind === "dump") {
        return {
            ...base,
            kind,
            windowMinutes: typeof obj.windowMinutes === "number" ? obj.windowMinutes : 5,
            thresholdPct: typeof obj.thresholdPct === "number" ? obj.thresholdPct : 3,
        };
    }
    const price = typeof obj.price === "number" ? obj.price : Number(obj.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
        ...base,
        kind: obj.direction === "below" ? "price-down" : "price-up",
        price,
    };
}