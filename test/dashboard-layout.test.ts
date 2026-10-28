import { describe, expect, it } from "vitest";
import dashboardHtml from "../playground/dashboard.html?raw";
import dashboardSource from "../playground/dashboard.ts?raw";

// Guards the "保存布局" flow: the save button reveals an inline name input that
// commits on Enter. The commit latch must reset when a new save starts,
// otherwise Enter stops working after the first save.

describe("dashboard layout save", () => {
    it("reveals an inline name input with an Enter-to-save hint", () => {
        expect(dashboardHtml).toContain('id="save-layout-btn"');
        expect(dashboardHtml).toContain('id="layout-name-input"');
        expect(dashboardHtml).toContain("布局名称，回车保存");
    });

    it("supports deleting a saved layout from the dropdown", () => {
        expect(dashboardHtml).toContain('id="delete-layout-btn"');
        expect(dashboardSource).toContain("function syncDeleteLayoutBtn()");
        expect(dashboardSource).toContain("layouts = layouts.filter((l) => l.id !== id)");
        expect(dashboardSource).toContain('confirm(`确定删除布局方案「${name}」吗？`)');
    });

    it("notifies when a legacy layout has no grid structure to restore", () => {
        expect(dashboardSource).toContain("该方案为旧版，仅恢复每格内容；重新保存一次可包含网格结构");
    });

    it("defaults to a fixed 1-cell layout that 默认布局 resets to", () => {
        expect(dashboardSource).toContain('layout: "1"');
        expect(dashboardSource).toContain("const DEFAULT_LAYOUT_ID = \"1\"");
        expect(dashboardSource).toContain("function applyDefaultLayout()");
        expect(dashboardSource).toContain("applyDefaultLayout()");
    });

    it("keeps 默认布局 a real option separate from the neutral placeholder", () => {
        // The neutral placeholder is ""; selecting it must NOT be treated as
        // "apply default", otherwise re-selecting the default after switching
        // away never fires "change" (native select no-op on same value).
        expect(dashboardSource).toContain('const DEFAULT_OPTION_VALUE = "__default__";');
        expect(dashboardHtml).toContain("<option value=\"\">— 选择布局 —</option>");
        expect(dashboardSource).toContain("默认布局（1格）");
        expect(dashboardSource).toContain(
            "if (value === DEFAULT_OPTION_VALUE) {\n    applyDefaultLayout();",
        );
        // Startup pins the dropdown to the default so the live scheme is visible.
        expect(dashboardSource).toContain("activeLayoutId = DEFAULT_OPTION_VALUE;");
        expect(dashboardSource).toContain("renderLayoutPicker(DEFAULT_OPTION_VALUE)");
    });

    it("supports renaming a saved layout from the dropdown", () => {
        expect(dashboardHtml).toContain('id="rename-layout-btn"');
        expect(dashboardHtml).toContain('id="rename-layout-input"');
        expect(dashboardHtml).toContain("新名称，回车确认");
        expect(dashboardSource).toContain('renameLayoutBtn.addEventListener("click"');
        expect(dashboardSource).toContain("renameCommitted = false;");
        expect(dashboardSource).toContain("layout.name = name");
        expect(dashboardSource).toContain("renderLayoutPicker(layout.id)");
    });

    it("resets the commit latch when starting a new save", () => {
        expect(dashboardSource).toContain("layoutCommitted = false;");
        expect(dashboardSource).toContain('layoutNameInput.addEventListener("keydown"');
        expect(dashboardSource).toContain('if (e.key === "Enter") commitLayout()');
    });

    it("pins the dropdown to the applied scheme, dropping the pin once the grid diverges", () => {
        // After applying/saving, the dropdown shows the live scheme…
        expect(dashboardSource).toContain("renderLayoutPicker(layout.id)");
        expect(dashboardSource).toContain(
            "} else if (activeId && layouts.some((l) => l.id === activeId)) {",
        );
        expect(dashboardSource).toContain("select.value = activeId;");
        // …and a grid/content change drops the pin so re-selecting the same
        // scheme still fires "change" and reapplies it.
        expect(dashboardSource).toContain("function markLayoutDirty()");
        expect(dashboardSource).toContain('dashboard.on("layout:changed"');
        expect(dashboardSource).toContain('dashboard.on("state:changed"');
        expect(dashboardSource).toContain("applyingLayout");
    });

    it("applies saved items by cell id with a positional fallback", () => {
        expect(dashboardSource).toContain("const cell = dashboard.cell(item.cellId) ?? cells[i];");
    });

    it("captures and stores the grid layout id when saving", () => {
        expect(dashboardSource).toContain("const def = dashboard.layout;");
        expect(dashboardSource).toContain("layoutId: def.id");
        expect(dashboardSource).toContain("layoutId: captured.layoutId");
        expect(dashboardSource).toContain("type SavedLayout = {");
        expect(dashboardSource).toContain("layoutId: string;");
    });

    it("captures the grid definition so custom/split layouts re-register on apply", () => {
        expect(dashboardSource).toContain("grid: {");
        expect(dashboardSource).toContain("id: def.id");
        expect(dashboardSource).toContain("registerLayout(grid)");
        expect(dashboardSource).toContain("dashboard.setLayout(grid.id)");
    });

    it("backfills the grid definition for schemes saved without one", () => {
        expect(dashboardSource).toContain("function backfillLayoutGrids()");
        expect(dashboardSource).toContain("ensureLayout(layout.layoutId)");
        expect(dashboardSource).toContain("backfillLayoutGrids();");
    });

    it("migrates legacy saved layouts without a layoutId", () => {
        expect(dashboardSource).toContain('layoutId: typeof l.layoutId === "string" ? l.layoutId : ""');
    });
});