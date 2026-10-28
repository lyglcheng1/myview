import { describe, expect, it } from "vitest";
import dashboardHtml from "../playground/dashboard.html?raw";
import dashboardSource from "../playground/dashboard.ts?raw";
import holdingsSource from "../playground/holdings.ts?raw";

// Guards the holdings view integration in the dashboard shell: the sidebar
// entry, the overlay view markup, the settings tab, and the network/data
// wiring in holdings.ts. These are browser-verified interactions; this test
// ensures the wiring cannot be silently deleted.

describe("dashboard holdings view markup", () => {
    it("provides the fixed sidebar entry", () => {
        expect(dashboardHtml).toContain('id="holdings-entry"');
        expect(dashboardHtml).toContain("💼");
    });

    it("contains the holdings table and toolbar ids", () => {
        expect(dashboardHtml).toContain('id="holdings-view"');
        expect(dashboardHtml).toContain('id="holdings-tbody"');
        expect(dashboardHtml).toContain('id="holdings-add-btn"');
        expect(dashboardHtml).toContain('class="currency-toggle"');
        expect(dashboardHtml).toContain('id="holdings-rate"');
    });

    it("shows a per-row P/L amount column right after 当前市值", () => {
        // 盈亏金额 = 当前市值 - 买入市值, rendered as a signed, colored cell.
        expect(dashboardHtml).toMatch(/<th>当前市值<\/th>\s*<th>盈亏金额<\/th>/);
        expect(dashboardHtml).toMatch(/<th>盈亏金额<\/th>\s*<th>盈亏百分比<\/th>/);
        expect(holdingsSource).toContain('data-field="profitAmount"');
        expect(holdingsSource).toContain("formatMoney(row.profit, currency, rate)");
        expect(holdingsSource).toContain("profitClass(row.profit)");
        expect(holdingsSource).toContain('colspan="12"');
    });

    it("contains the totals, charts and add-form ids", () => {
        expect(dashboardHtml).toContain('id="total-buy-value"');
        expect(dashboardHtml).toContain('id="total-now-value"');
        expect(dashboardHtml).toContain('id="total-profit-pct"');
        expect(dashboardHtml).toContain('id="amount-bar-chart"');
        expect(dashboardHtml).toContain('id="asset-pie-chart"');
        expect(dashboardHtml).toContain('id="new-symbol"');
    });

    it("renders the asset-share pie chart with per-coin colors and amounts", () => {
        expect(dashboardHtml).toContain('class="pie-chart"');
        expect(dashboardHtml).toContain("资产占比");
        expect(holdingsSource).toContain("function renderPieChart");
        expect(holdingsSource).toContain("stroke-dasharray");
        expect(holdingsSource).toContain("pie-legend");
        expect(holdingsSource).toContain("formatMoney(r.currentMarketValue, currency, rate)");
    });

    it("colors the amount columns per coin, centers a bigger pie, and shows units", () => {
        expect(dashboardHtml).toContain("width: 180px");
        expect(dashboardHtml).toContain("width: fit-content");
        expect(dashboardHtml).toContain("bar-column");
        expect(dashboardHtml).toContain("bar-col-track");
        expect(dashboardHtml).toContain(".bar-chart::before");
        expect(holdingsSource).toContain("function barColumn");
        expect(holdingsSource).toContain("height:${height}%");
        expect(holdingsSource).toContain("background:${color}");
        expect(holdingsSource).toContain("badgeColor(base)");
        expect(holdingsSource).toContain("amountText");
    });

    it("separates 自选 and 功能模块 into sidebar tabs", () => {
        expect(dashboardHtml).toContain('id="watchlist-tab"');
        expect(dashboardHtml).toContain('id="holdings-tab"');
        expect(dashboardHtml).toContain("💼 功能模块");
        expect(dashboardHtml).toContain('id="watchlist-panel"');
        expect(dashboardHtml).toContain('id="holdings-panel"');
    });

    it("flows watchlist groups by name width instead of one per row", () => {
        expect(dashboardHtml).toContain("flex-wrap: wrap");
        expect(dashboardHtml).toContain("flex: 0 0 auto");
        expect(dashboardHtml).toContain("max-width: 100%");
    });

    it("moves the collapse button to the sidebar's right edge", () => {
        expect(dashboardHtml).toContain("#collapse-btn");
        expect(dashboardHtml).toContain("left: 232px");
        expect(dashboardHtml).toContain("border-radius: 0 6px 6px 0");
        expect(dashboardHtml).toContain("#main.sidebar-collapsed #collapse-btn");
    });

    it("lays the view out right of the sidebar with a draggable table/chart splitter", () => {
        expect(dashboardHtml).toContain("#main.sidebar-collapsed #holdings-view");
        expect(dashboardHtml).toContain("left: 232px");
        expect(dashboardHtml).toContain('id="holdings-splitter"');
        expect(dashboardHtml).toContain("--holdings-table-ratio, 50%");
        expect(dashboardHtml).toContain("cursor: ns-resize");
    });

    it("adds a 持仓设置 tab to the settings modal", () => {
        expect(dashboardHtml).toContain('data-panel="holdings"');
        expect(dashboardHtml).toContain('id="rate-mode"');
        expect(dashboardHtml).toContain('id="rate-manual"');
        expect(dashboardHtml).toContain('id="rate-last-auto"');
    });
});

describe("holdings.ts data wiring", () => {
    it("uses the Binance ticker/price endpoint for current prices", () => {
        expect(holdingsSource).toContain("https://api.binance.com/api/v3/ticker/price");
    });

    it("uses the user-confirmed CoinGecko endpoint for the USDT→CNY rate", () => {
        expect(holdingsSource).toContain(
            "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny,usd",
        );
    });

    it("treats USDT holdings as a constant 1.0 price", () => {
        expect(holdingsSource).toContain('prices = new Map<string, number>([["USDT", 1]]);');
        expect(holdingsSource).toContain('s !== "USDT"');
    });

    it("persists to localStorage and normalizes symbols to USDT pairs", () => {
        expect(holdingsSource).toContain('"vela-dashboard-holdings-v1"');
        expect(holdingsSource).toContain("normalizeSymbol");
    });

    it("persists the table/chart split ratio", () => {
        expect(holdingsSource).toContain('"vela-dashboard-holdings-split-v1"');
        expect(holdingsSource).toContain("function initSplitter");
        expect(holdingsSource).toContain("--holdings-table-ratio");
    });

    it("exposes the view-activation hook used by dashboard.ts", () => {
        expect(holdingsSource).toContain("export function setHoldingsViewActive");
    });

    it("exposes the quick-set alert bridge and row action used by dashboard.ts", () => {
        expect(holdingsSource).toContain("export function setAlertQuickSetHandler");
        expect(holdingsSource).toContain('class="holdings-alert-btn"');
        expect(holdingsSource).toContain("alertQuickSetHandler?.(h.symbol)");
    });
});

describe("dashboard.ts view switching", () => {
    it("wires initHoldingsView and the show/show-kline functions", () => {
        expect(dashboardSource).toContain("initHoldingsView()");
        expect(dashboardSource).toContain("function showHoldingsView");
        expect(dashboardSource).toContain("function showKlineView");
    });

    it("wires the sidebar tabs to the view switcher", () => {
        expect(dashboardSource).toContain("function setSidebarTab");
        expect(dashboardSource).toContain('watchlistTabEl.addEventListener("click"');
        expect(dashboardSource).toContain('holdingsTabEl.addEventListener("click"');
        expect(dashboardSource).toContain('setSidebarTab("watchlist")');
        expect(dashboardSource).toContain('setSidebarTab("holdings")');
    });

    it("switches back to the K-line grid from groups, tokens and blank space", () => {
        expect(dashboardSource).toContain('holdingsEntryEl.addEventListener("click", showHoldingsView)');
        expect(dashboardSource).toContain("showKlineView();");
    });

    it("registers the holdings quick-set alert handler and honors the prefilled symbol", () => {
        expect(dashboardSource).toContain("setAlertQuickSetHandler((symbol) => {");
        expect(dashboardSource).toContain("alertSymbolInput.value.trim() || activeCellSymbol()");
        expect(dashboardSource).toContain("surgeSymbolInput.value.trim() || activeCellSymbol()");
        expect(holdingsSource).toContain('class="holdings-actions"');
    });
});