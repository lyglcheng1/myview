import { describe, expect, it } from "vitest";
import {
    extractFirstImage,
    markdownToPlainText,
    renderMarkdown,
} from "../playground/tradePlan/markdown";

describe("trade plan markdown renderer", () => {
    it("renders headings, bold, italic, strikethrough, lists, quote and hr", () => {
        const html = renderMarkdown("# 目标\n\n**bold** *italic* ~~gone~~\n\n- a\n- b\n\n> 引用\n\n---");
        expect(html).toContain("<h1>目标</h1>");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("<em>italic</em>");
        expect(html).toContain("<del>gone</del>");
        expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
        expect(html).toContain("<blockquote>引用</blockquote>");
        expect(html).toContain("<hr />");
    });

    it("renders inline and fenced code without reinterpreting markdown inside", () => {
        const html = renderMarkdown("用 `code *x*` 表示\n\n```\n**不是粗体**\n```");
        expect(html).toContain("<code>code *x*</code>");
        expect(html).toContain("<pre><code>**不是粗体**</code></pre>");
    });

    it("renders https links with target blank and noopener", () => {
        const html = renderMarkdown("[文档](https://example.com)");
        expect(html).toContain(
            '<a href="https://example.com" target="_blank" rel="noopener noreferrer">文档</a>',
        );
    });

    it("never emits clickable javascript: links — the token stays literal", () => {
        const html = renderMarkdown("[bad](javascript:alert(1))");
        expect(html).not.toContain('<a href="javascript:');
        expect(html).toContain("[bad](javascript:alert(1))");
    });

    it("embeds data:image and https images and ignores other srcs", () => {
        const data = "data:image/png;base64,AAAA";
        expect(renderMarkdown(`![图](${data})`)).toContain(`<img src="${data}"`);
        expect(renderMarkdown("![图](https://example.com/a.png)")).toContain(
            '<img src="https://example.com/a.png"',
        );
        expect(renderMarkdown("![图](file:///etc/passwd)")).not.toContain("<img");
    });

    it("emits a data-vela-img placeholder for vela-img references", () => {
        const html = renderMarkdown("![图](vela-img://abc123)");
        expect(html).toContain('<img data-vela-img="abc123" alt="图" loading="lazy" />');
        expect(html).not.toContain('src="vela-img://');
    });

    it("HTML-escapes raw tags and entities before rendering", () => {
        const html = renderMarkdown("<script>alert(1)</script> & <b>x</b>");
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("&amp;");
        expect(html).not.toContain("<b>x</b>");
    });

    it("renders simple tables", () => {
        const html = renderMarkdown("| 币种 | 价格 |\n| --- | --- |\n| BTCUSDT | 60000 |");
        expect(html).toContain("<table>");
        expect(html).toContain("<th>币种</th>");
        expect(html).toContain("<td>60000</td>");
    });

    it("strips markdown to a plain-text excerpt", () => {
        expect(
            markdownToPlainText("## 目标\n\n买入 **BTCUSDT**，目标 [链接](https://x) 到 70000 元"),
        ).toBe("目标 买入 BTCUSDT，目标 链接 到 70000 元");
    });

    it("extracts the first image src for card thumbnails", () => {
        expect(extractFirstImage("![图](data:image/png;base64,AAAA)")).toBe(
            "data:image/png;base64,AAAA",
        );
        expect(extractFirstImage("![图](vela-img://abc123)")).toBe("vela-img://abc123");
        expect(extractFirstImage("没有图片")).toBeNull();
    });
});