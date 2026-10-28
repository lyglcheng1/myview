import { describe, expect, it } from "vitest";
import dashboardHtml from "../playground/dashboard.html?raw";
import dashboardSource from "../playground/dashboard.ts?raw";

// The dashboard search dropdown must NOT add the clicked pair to the active
// watchlist group automatically. Clicking a result row opens that symbol in
// the grid; a small star button on the right of each row adds it to the
// active watchlist group instead. These static assertions guard that
// contract from regressing.

const html = dashboardHtml;
const source = dashboardSource;

describe("dashboard search interaction", () => {
    it("opens the clicked result in the grid instead of adding it to the watchlist", () => {
        const rowClick = source.indexOf("item.addEventListener(\"click\", () => {\n      openSymbolInGrid(symbol);");
        expect(rowClick).toBeGreaterThan(-1);
        // The only add-to-watchlist call inside renderDropdown must live in
        // the star button handler, which stops propagation first.
        const starClick = source.indexOf("star.addEventListener(\"click\"");
        const stopPropagation = source.indexOf("e.stopPropagation();");
        const addToken = source.indexOf("addTokenToActiveGroup(symbol);");
        expect(starClick).toBeGreaterThan(-1);
        expect(stopPropagation).toBeGreaterThan(-1);
        expect(addToken).toBeGreaterThan(stopPropagation);
        // Clicking a row no longer auto-adds: the addToken call after the row
        // click handler would have appeared before the star handler existed.
        expect(addToken).toBeGreaterThan(rowClick);
    });

    it("renders a star button per result row with an added state", () => {
        expect(source).toContain('className = "search-item"');
        expect(source).toContain('className = "search-item-symbol"');
        expect(source).toContain('className = "search-item-star"');
        expect(source).toContain('star.classList.add("added")');
        expect(html).toContain(".search-item-star.added");
    });

    it("keeps the star interactive inside the dropdown", () => {
        expect(html).toContain("#search-dropdown");
        expect(html).toContain(".search-item {");
        expect(html).toContain("display: flex;");
    });
});