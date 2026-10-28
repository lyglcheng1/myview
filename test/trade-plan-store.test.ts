import { describe, expect, it } from "vitest";
import { createMemoryTradePlanBackend, createTradePlanStore } from "../playground/tradePlan/store";
import type { TradePlan } from "../playground/tradePlan/types";

function makePlan(id: string, updatedAt = 1): TradePlan {
    return { id, createdAt: 1, updatedAt, ticker: "BTCUSDT", name: "BTC", markdown: "# x" };
}

describe("trade plan store", () => {
    it("saves and lists plans newest-first", async () => {
        const store = createTradePlanStore(createMemoryTradePlanBackend());
        await store.save(makePlan("a", 100));
        await store.save(makePlan("b", 200));
        const plans = await store.list();
        expect(plans.map((p) => p.id)).toEqual(["b", "a"]);
    });

    it("gets a single plan and returns null for missing ids", async () => {
        const store = createTradePlanStore(createMemoryTradePlanBackend());
        await store.save(makePlan("a"));
        expect((await store.get("a"))?.markdown).toBe("# x");
        expect(await store.get("missing")).toBeNull();
    });

    it("replaces the same id on save", async () => {
        const store = createTradePlanStore(createMemoryTradePlanBackend());
        await store.save(makePlan("a", 1));
        await store.save({ ...makePlan("a", 2), markdown: "# updated" });
        expect((await store.get("a"))?.markdown).toBe("# updated");
        expect((await store.list())[0]!.updatedAt).toBe(2);
    });

    it("removes plans by id", async () => {
        const store = createTradePlanStore(createMemoryTradePlanBackend());
        await store.save(makePlan("a"));
        await store.save(makePlan("b"));
        await store.remove("a");
        expect((await store.list()).map((p) => p.id)).toEqual(["b"]);
    });

    it("ignores corrupt records when listing", async () => {
        const backend = createMemoryTradePlanBackend();
        await backend.put("bad", { id: "bad" }); // missing required fields
        const store = createTradePlanStore(backend);
        expect(await store.list()).toEqual([]);
    });

    it("clears all plans", async () => {
        const store = createTradePlanStore(createMemoryTradePlanBackend());
        await store.save(makePlan("a"));
        await store.clear();
        expect(await store.list()).toEqual([]);
    });
});