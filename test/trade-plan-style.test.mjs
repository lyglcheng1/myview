// Guards the trade-plan feature's UX regressions: the HTML `hidden` attribute
// must win over the panel's `display:flex` rules, the feature entry and panel
// container must be wired into the dashboard, and the panel must support
// creating / editing / saving / deleting plans with a split Markdown editor.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tradePlanSource from "../playground/tradePlan/tradePlan.ts?raw";
import dashboardHtml from "../playground/dashboard.html?raw";

const tradePlanCss = readFileSync(
    fileURLToPath(new URL("../playground/tradePlan/tradePlan.css", import.meta.url)),
    "utf8",
);

describe("trade plan styling & UX", () => {
    it("never lets the hidden attribute be overridden by display:flex", () => {
        expect(tradePlanCss).toContain("#trade-plan-app [hidden]");
        expect(tradePlanCss).toContain("display: none !important;");
    });

    it("adds the feature entry and panel container to the dashboard", () => {
        expect(dashboardHtml).toContain('id="feature-trade-plan"');
        expect(dashboardHtml).toContain('data-feature="trade-plan"');
        expect(dashboardHtml).toContain('id="trade-plan-app"');
        expect(dashboardHtml).toContain('id="trade-plan-list"');
        expect(dashboardHtml).toContain('id="trade-plan-editor"');
        expect(dashboardHtml).toContain('id="trade-plan-message"');
        expect(tradePlanCss).toContain(".trade-plan-message");
    });

    it("keeps visible focus indicators on interactive controls", () => {
        expect(tradePlanCss).toContain(".trade-plan-new:focus-visible");
        expect(tradePlanCss).toContain(".trade-plan-card-delete:focus-visible");
        expect(tradePlanCss).toContain(".trade-plan-md-btn:focus-visible");
        expect(tradePlanCss).toContain(".trade-plan-page-btn:focus-visible");
        expect(tradePlanCss).toContain(".trade-plan-markdown:focus");
    });

    it("provides markdown formatting toolbar buttons", () => {
        for (const action of ["bold", "italic", "strike", "heading", "quote", "ul", "ol", "code", "codeblock", "link", "hr", "table"]) {
            expect(dashboardHtml).toContain(`data-md-action="${action}"`);
        }
        expect(tradePlanSource).toContain("wrapSelection(");
        expect(tradePlanSource).toContain("toggleLinePrefix(");
        expect(tradePlanSource).toContain("insertFencedCode(");
        expect(tradePlanSource).toContain("insertLink(");
        expect(tradePlanSource).toContain("insertHr(");
        expect(tradePlanSource).toContain("insertTable(");
        expect(tradePlanSource).toContain("button[data-md-action]");
        expect(tradePlanCss).toContain(".trade-plan-md-btn");
        expect(tradePlanCss).toContain(".trade-plan-toolbar-sep");
    });

    it("searches and paginates the plan list", () => {
        expect(dashboardHtml).toContain('id="trade-plan-search"');
        expect(dashboardHtml).toContain('id="trade-plan-page-prev"');
        expect(dashboardHtml).toContain('id="trade-plan-page-next"');
        expect(dashboardHtml).toContain('id="trade-plan-page-info"');
        expect(tradePlanSource).toContain("filterPlans(");
        expect(tradePlanSource).toContain("paginate(");
        expect(tradePlanSource).toContain("TRADE_PLAN_PAGE_SIZE");
        expect(tradePlanSource).toContain('searchInput.addEventListener("input"');
        expect(tradePlanSource).toContain("pagePrev.addEventListener(");
        expect(tradePlanSource).toContain("pageNext.addEventListener(");
        expect(tradePlanCss).toContain(".trade-plan-search");
        expect(tradePlanCss).toContain(".trade-plan-page-btn");
        expect(tradePlanCss).toContain(".trade-plan-sort-hint");
    });

    it("wires create / edit / save / delete / image insertion", () => {
        expect(tradePlanSource).toContain("initTradePlan(");
        expect(tradePlanSource).toContain("getActiveChart");
        expect(tradePlanSource).toContain("formatPlanId(");
        expect(tradePlanSource).toContain("uniquePlanId(");
        expect(tradePlanSource).toContain("void createNewPlan()");
        expect(tradePlanSource).toContain("void saveCurrentPlan()");
        expect(tradePlanSource).toContain("void deletePlan(");
        expect(tradePlanSource).toContain("void refreshList()");
        expect(tradePlanSource).toContain("showMessage(");
        expect(tradePlanSource).toContain("insertImageAsDataUrl(");
        expect(tradePlanSource).toContain("renderMarkdown(");
        expect(tradePlanSource).toContain("createTradePlanStore(");
    });

    it("splits the editor into markdown source and live preview", () => {
        expect(dashboardHtml).toContain('id="trade-plan-markdown"');
        expect(dashboardHtml).toContain('id="trade-plan-preview"');
        expect(dashboardHtml).toContain('id="trade-plan-editor-divider"');
        expect(tradePlanSource).toContain('textarea.addEventListener("input", schedulePreview)');
        expect(tradePlanSource).toContain("preview.innerHTML = renderMarkdown(");
    });

    it("stores images separately and keeps markdown compact", () => {
        expect(tradePlanSource).toContain("createImageStore(");
        expect(tradePlanSource).toContain("imageStore.save(");
        expect(tradePlanSource).toContain("extractImageIds(");
        expect(tradePlanSource).toContain("resolveImageSrcs(");
        expect(tradePlanSource).toContain("vela-img://");
    });

    it("supports a read-only view opened by double-clicking a card", () => {
        expect(dashboardHtml).toContain('id="trade-plan-edit"');
        expect(tradePlanSource).toContain('list.addEventListener("dblclick"');
        expect(tradePlanSource).toContain("openReadonly(");
        expect(tradePlanSource).toContain("openEditor(plan)");
        expect(tradePlanSource).toContain('editBtn.addEventListener("click"');
        expect(tradePlanCss).toContain(".trade-plan-editor.readonly .trade-plan-markdown");
        expect(tradePlanCss).toContain(".trade-plan-editor.readonly .trade-plan-preview");
        expect(tradePlanCss).toContain(".trade-plan-edit");
    });
});