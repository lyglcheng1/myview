// Guards the Pine screener's UX regressions: the HTML `hidden` attribute must
// win over the panel's `display:flex` rules (otherwise "扫描中，请稍候…" stays
// on screen after a scan finishes), completed scans must be saved with a date
// and be re-viewable / re-runnable / deletable, and the feature entry must be
// wired into the dashboard sidebar. The CSS is read from disk because `?raw`
// returns an empty string for CSS in this vitest setup.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import screenerSource from "../playground/screener/pineScreener.ts?raw";
import dashboardHtml from "../playground/dashboard.html?raw";
import dashboardSource from "../playground/dashboard.ts?raw";

const screenerCss = readFileSync(
    fileURLToPath(new URL("../playground/screener/pineScreener.css", import.meta.url)),
    "utf8",
);

describe("pine screener styling & UX", () => {
    it("never lets the hidden attribute be overridden by display:flex", () => {
        expect(screenerCss).toContain("#pine-screener-app [hidden]");
        expect(screenerCss).toContain("display: none !important;");
    });

    it("keeps visible focus indicators on the history controls", () => {
        expect(screenerCss).toContain("#screener-history-select:focus");
        expect(screenerCss).toContain(".screener-history .screener-history-btn");
    });

    it("adds saved-scan history controls to the panel", () => {
        expect(dashboardHtml).toContain('id="screener-history-select"');
        expect(dashboardHtml).toContain('id="screener-history-rerun"');
        expect(dashboardHtml).toContain('id="screener-history-delete"');
    });

    it("saves completed scans and supports delete/re-run", () => {
        expect(screenerSource).toContain("loadScanHistory");
        expect(screenerSource).toContain("persistScanHistory");
        expect(screenerSource).toContain("addScanToHistory");
        expect(screenerSource).toContain("removeScanFromHistory");
        expect(screenerSource).toContain("formatScanDate(");
        expect(screenerSource).toContain("void rerunScan(");
        expect(screenerSource).toContain("total: outcome.total");
    });

    it("renders the pre-selected saved scan when history controls refresh", () => {
        // Regression: after hydration the history dropdown is pre-set to the latest
        // scan, but the results only appeared on a `change` event. If the user never
        // picks a different option (or there is only one saved scan), no `change`
        // fires and the saved results stay invisible. `refreshHistoryControls` must
        // render the pre-selected scan itself.
        expect(screenerSource).toMatch(/function refreshHistoryControls\(\): void \{[\s\S]*renderSavedScan\(selected\);/);
    });

    it("captures the script at launch time so mid-scan dropdown changes cannot corrupt history", () => {
        // Regression: `startScan` read `currentScript.id/name` AFTER the await, so
        // switching the script dropdown while a scan ran saved the history entry
        // under the wrong script. The launched script must be captured before the
        // await and used for both the run and the saved history entry.
        expect(screenerSource).toMatch(/const script = currentScript;/);
        expect(screenerSource).toMatch(/source: script\.source/);
        expect(screenerSource).toMatch(/scriptId: script\.id/);
        expect(screenerSource).toMatch(/scriptName: script\.name/);
    });

    it("wires the Pine 选币 feature entry into the dashboard sidebar", () => {
        expect(dashboardHtml).toContain('id="feature-pine-screener"');
        expect(dashboardHtml).toContain('data-feature="pine-screener"');
        expect(dashboardHtml).toContain('id="pine-screener-app"');
        expect(dashboardHtml).toContain('id="screener-start"');
    });

    it("offers a market selector on the screener toolbar", () => {
        expect(dashboardHtml).toContain('id="screener-market"');
        expect(dashboardHtml).toContain('value="spot"');
        expect(dashboardHtml).toContain('value="futures"');
        expect(dashboardHtml).toContain('value="all"');
        expect(screenerSource).toContain('marketSelect: document.getElementById("screener-market")');
        expect(screenerSource).toContain('createScreenerDataSource({ historyBars, market, store })');
    });

    it("refreshes the script dropdown when the Pine 选币 feature opens", () => {
        // Regression: a script saved in the Pine dock only showed up in the
        // screener's script dropdown after a manual page refresh. Opening the
        // feature must re-read persisted scripts so the new script appears
        // immediately. This assertion fails if the refresh call is removed.
        expect(dashboardSource).toMatch(
            /function showFeatureView\(featureId: string\): void \{[\s\S]*if \(featureId === "pine-screener"\) refreshPineScreener\(\);/,
        );
    });

    it("keeps the scanning status stable while the coin name changes", () => {
        // Regression: the scanning status used to be one text blob with the coin
        // name at the end (`已扫描 130/500 · 命中 6 · BTC BTCUSDT`). As the coin
        // name's length changed, the whole line reflowed and the progress numbers
        // wobbled. The coin must now lead the message and `done/total` must render
        // in its own fixed-width, right-aligned slot. Removing either part makes
        // one of these source/CSS assertions fail.
        expect(screenerSource).toContain("function setStatusText(");
        expect(screenerSource).toContain('className = "screener-status-lead"');
        expect(screenerSource).toContain('className = "screener-status-count"');
        expect(screenerSource).toMatch(/正在扫描 \$\{p\.currentName\} \$\{p\.currentTicker\} · 命中 \$\{p\.matched\}/);
        expect(screenerSource).toContain('countEl.textContent = `${p.done}/${p.total}`;');
        expect(screenerCss).toMatch(/\.screener-status \{[^}]*display: inline-flex;/);
        expect(screenerCss).toMatch(/\.screener-status-lead \{[^}]*text-overflow: ellipsis;/);
        expect(screenerCss).toMatch(/\.screener-status-count \{[^}]*min-width: 8ch;/);
        expect(screenerCss).toMatch(/\.screener-status-count \{[^}]*text-align: right;/);
    });

    it("opens a floating K-line preview for screener results instead of leaving the panel", () => {
        // Regression: clicking a screener result used to switch the whole view to
        // the grid (`openSymbolInGrid` → `showKlineView`), hiding the screener and
        // forcing 功能模块 → Pine 选币 → history to browse the next match. A
        // floating preview window must be present and driven by the screener's
        // `onOpenSymbol` callback, with a "在网格打开" action as the explicit way
        // to leave the screener.
        expect(dashboardHtml).toContain('id="screener-preview"');
        expect(dashboardHtml).toContain('id="screener-preview-chart"');
        expect(dashboardHtml).toContain('id="screener-preview-timeframe"');
        expect(dashboardHtml).toContain('id="screener-preview-grid"');
        expect(dashboardSource).toContain("function showScreenerPreview(");
        expect(dashboardSource).toContain("function initScreenerPreviewWindow(");
        expect(dashboardSource).toContain('screenerPreviewChart.data.registerProvider("binance", new BinanceProvider())');
        expect(dashboardSource).toMatch(/initPineScreener\(\{ onOpenSymbol: \(ticker\) => showScreenerPreview\(ticker\) \}\)/);
        expect(dashboardSource).toMatch(/gridBtn\?\.addEventListener\("click", \(\) => \{[\s\S]*openSymbolInGrid\(screenerPreviewTicker\)/);
    });
});