import { describe, expect, it } from "vitest";
import dashboardSource from "../playground/dashboard.ts?raw";

// Guards the "no cell selected on startup" and "click background to deselect"
// behaviors in the dashboard shell. These are browser-verified interactions;
// this test ensures the wiring cannot be silently deleted.

describe("dashboard cell deselection", () => {
    it("does not pre-select the first grid cell on startup", () => {
        expect(dashboardSource).toContain("let activeCellId: string | null = null;");
        expect(dashboardSource).toContain("dashboard.setActiveCell(null);");
    });

    it("deselects the active cell when clicking empty workspace background", () => {
        expect(dashboardSource).toContain('if (!(e.target as Element).closest(".vela-cell"))');
        expect(dashboardSource).toContain("dashboard.setActiveCell(null);");
    });
});