// Unit tests for the trade-plan list helpers (`playground/tradePlan/paging.ts`):
// search by coin code / name / plan id, and page splitting with page clamping.

import { describe, expect, it } from "vitest";
import {
    TRADE_PLAN_PAGE_SIZE,
    filterPlans,
    paginate,
} from "../playground/tradePlan/paging";
import type { TradePlan } from "../playground/tradePlan/types";

function makePlan(overrides: Partial<TradePlan> = {}): TradePlan {
    const ticker = overrides.ticker ?? "BTCUSDT";
    const name = overrides.name ?? "BTC";
    return {
        id: `20260516-${ticker}-${name}`,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        ticker,
        name,
        markdown: "",
        ...overrides,
    };
}

describe("trade plan list filter & paging", () => {
    it("filters by coin code", () => {
        const plans = [
            makePlan({ ticker: "BTCUSDT", name: "BTC" }),
            makePlan({ ticker: "ETHUSDT", name: "ETH" }),
        ];
        expect(filterPlans(plans, "BTCUSDT")).toEqual([plans[0]]);
        expect(filterPlans(plans, "ETHUSDT")).toEqual([plans[1]]);
    });

    it("filters by coin name", () => {
        const plans = [
            makePlan({ ticker: "BTCUSDT", name: "BTC" }),
            makePlan({ ticker: "ETHUSDT", name: "ETH" }),
        ];
        expect(filterPlans(plans, "ETH")).toEqual([plans[1]]);
        expect(filterPlans(plans, "BTC")).toEqual([plans[0]]);
    });

    it("matches the plan id (code embedded in the name)", () => {
        const plans = [makePlan(), makePlan({ id: "20260516-ETHUSDT-ETH", ticker: "ETHUSDT", name: "ETH" })];
        expect(filterPlans(plans, "20260516-ETHUSDT")).toEqual([plans[1]]);
    });

    it("is case-insensitive and trims the query", () => {
        const plans = [makePlan({ ticker: "BTCUSDT" }), makePlan({ ticker: "ETHUSDT" })];
        expect(filterPlans(plans, "  BTCUSDT  ")).toEqual([plans[0]]);
        expect(filterPlans(plans, "btcusdt")).toEqual([plans[0]]);
    });

    it("returns all plans for an empty or whitespace query", () => {
        const plans = [makePlan(), makePlan({ id: "x", ticker: "SOLUSDT", name: "SOL" })];
        expect(filterPlans(plans, "")).toEqual(plans);
        expect(filterPlans(plans, "   ")).toEqual(plans);
    });

    it("returns no plans when nothing matches", () => {
        const plans = [makePlan()];
        expect(filterPlans(plans, "不存在")).toEqual([]);
    });

    it("paginates 25 items into 3 pages of 10", () => {
        const items = Array.from({ length: 25 }, (_, i) => makePlan({ id: `p${i}` }));
        const p1 = paginate(items, 1, TRADE_PLAN_PAGE_SIZE);
        expect(p1.pageItems).toHaveLength(10);
        expect(p1.pageItems[0]).toBe(items[0]);
        expect(p1.totalPages).toBe(3);
        const p3 = paginate(items, 3, TRADE_PLAN_PAGE_SIZE);
        expect(p3.pageItems).toHaveLength(5);
        expect(p3.pageItems[0]).toBe(items[20]);
    });

    it("clamps out-of-range pages into [1, totalPages]", () => {
        const items = Array.from({ length: 5 }, (_, i) => makePlan({ id: `p${i}` }));
        expect(paginate(items, 99, TRADE_PLAN_PAGE_SIZE).page).toBe(1);
        expect(paginate(items, -3, TRADE_PLAN_PAGE_SIZE).page).toBe(1);
        expect(paginate(items, 0, TRADE_PLAN_PAGE_SIZE).page).toBe(1);
    });

    it("handles an empty list with a single (empty) page", () => {
        const p = paginate([], 1, TRADE_PLAN_PAGE_SIZE);
        expect(p.pageItems).toEqual([]);
        expect(p.totalPages).toBe(1);
        expect(p.page).toBe(1);
    });
});