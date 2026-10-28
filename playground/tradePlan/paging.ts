// Pure list-filtering and pagination helpers for the trade-plan list.
//
// Kept DOM-free so the search + paging behavior is unit-testable in Node. The
// list itself is already sorted newest-first by `store.list()` (`updatedAt`
// descending); these helpers only narrow the sorted result.

import type { TradePlan } from "./types";

export const TRADE_PLAN_PAGE_SIZE = 10;

/** Filter plans by coin ticker / coin name / plan id (case-insensitive). */
export function filterPlans(plans: TradePlan[], query: string): TradePlan[] {
    const q = query.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter(
        (p) =>
            p.ticker.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            p.id.toLowerCase().includes(q),
    );
}

/**
 * Split `items` into pages of `pageSize`, clamping `page` to [1, totalPages].
 * Returns the current page's items, the total page count and the clamped page.
 */
export function paginate<T>(
    items: T[],
    page: number,
    pageSize: number,
): { pageItems: T[]; totalPages: number; page: number } {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const current = Math.min(Math.max(1, page), totalPages);
    const start = (current - 1) * pageSize;
    return {
        pageItems: items.slice(start, start + pageSize),
        totalPages,
        page: current,
    };
}