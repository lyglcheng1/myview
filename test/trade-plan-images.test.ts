// Unit tests for the trade-plan image store (`playground/tradePlan/images.ts`):
// save/get/delete round-trips against an in-memory backend, and `extractImageIds`
// collects the `vela-img://` references embedded in markdown.

import { describe, expect, it } from "vitest";
import {
    createImageStore,
    createMemoryImageBackend,
    extractImageIds,
} from "../playground/tradePlan/images";

describe("trade plan image store", () => {
    it("round-trips a data URL through save/get", async () => {
        const store = createImageStore(createMemoryImageBackend());
        const id = await store.save("data:image/png;base64,AAAA");
        expect(id.length).toBeGreaterThan(0);
        expect(id.length).toBeLessThan(40);
        expect(await store.get(id)).toBe("data:image/png;base64,AAAA");
    });

    it("returns null for a missing image id", async () => {
        const store = createImageStore(createMemoryImageBackend());
        expect(await store.get("missing")).toBeNull();
    });

    it("deletes images by id and ignores missing ids", async () => {
        const store = createImageStore(createMemoryImageBackend());
        const a = await store.save("data:image/png;base64,AAA");
        const b = await store.save("data:image/png;base64,BBB");
        await store.delete([a, "nope"]);
        expect(await store.get(a)).toBeNull();
        expect(await store.get(b)).toBe("data:image/png;base64,BBB");
    });

    it("generates distinct ids for distinct saves", async () => {
        const store = createImageStore(createMemoryImageBackend());
        const a = await store.save("data:image/png;base64,AAA");
        const b = await store.save("data:image/png;base64,BBB");
        expect(a).not.toBe(b);
    });

    it("extracts deduplicated vela-img references from markdown", () => {
        const md =
            "![图](vela-img://abc123)\n\n![另一张](vela-img://abc123)\n\n![图](data:image/png;base64,XXXX)";
        expect(extractImageIds(md)).toEqual(["abc123"]);
    });

    it("returns no image ids for markdown without vela-img references", () => {
        expect(extractImageIds("## 目标\n\n无图")).toEqual([]);
        expect(extractImageIds("![图](data:image/png;base64,XXXX)")).toEqual([]);
    });
});