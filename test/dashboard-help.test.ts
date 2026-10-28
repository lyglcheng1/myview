import { describe, expect, it } from "vitest";
import dashboardHtml from "../playground/dashboard.html?raw";

// The dashboard help dialog lives directly in playground/dashboard.html:
// a bottom-left "说明" button next to "设置" opens a modal that explains the
// features and the network footprint (Binance as the primary exit, CoinGecko
// only for the holdings USDT->CNY rate). This test guards that the explainer
// (and its data-source claims) stay present.

const html = dashboardHtml;

describe("dashboard help dialog", () => {
    it("places a help button immediately left of the settings button", () => {
        expect(html).toContain('id="help-btn"');
        expect(html).toContain('id="settings-btn"');
        const helpIdx = html.indexOf('id="help-btn"');
        const settingsIdx = html.indexOf('id="settings-btn"');
        expect(helpIdx).toBeGreaterThan(-1);
        expect(settingsIdx).toBeGreaterThan(helpIdx);
    });

    it("explains the Binance data sources and the CoinGecko rate exit", () => {
        expect(html).toContain("wss://stream.binance.com");
        expect(html).toContain("https://api.binance.com");
        expect(html).toContain("https://fapi.binance.com");
        expect(html).toContain("https://api.coingecko.com");
        expect(html).toContain("主要网络出口");
        expect(html).toContain("不依赖任何自建服务器");
    });

    it("provides a close button and a privacy statement", () => {
        expect(html).toContain('id="help-close-btn"');
        expect(html).toContain("仅保存在本机浏览器");
    });
});