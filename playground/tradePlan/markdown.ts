// Self-built safe-subset Markdown renderer for trade plans.
//
// No third-party Markdown library is allowed (frozen tech stack). Instead we
// support a curated subset — headings, bold/italic/strikethrough, lists,
// blockquote, inline/fenced code, links, images, tables, hr and paragraphs.
//
// Security model: the raw source is PARSED for structure, but every text
// fragment is HTML-escaped at the moment a tag is generated, so raw HTML in the
// source can never become executable. Image `src` is restricted to `data:image/`
// and `https://`; `vela-img://<id>` references are emitted as a `data-vela-img`
// attribute (no `src`) and resolved asynchronously by the trade-plan view from
// the image store. Link `href` to `https://` only. Pure functions, DOM-free,
// unit-testable in Node.

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

function escapeHtml(s: string): string {
    return s.replace(ESCAPE_RE, (c) => ESCAPE_MAP[c]!);
}

/** Render `[text](https://…)` links — other schemes stay as literal text. */
function renderLinkToken(token: string): string {
    const close = token.indexOf("](");
    const text = token.slice(1, close);
    const url = token.slice(close + 2, -1).trim();
    if (!/^https:\/\//i.test(url)) return token;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

/** Render `![alt](src)` images — `data:image/` and `https://` get a direct src;
 * `vela-img://<id>` is emitted as `data-vela-img` (no `src`) and resolved later. */
function renderImageToken(token: string): string {
    const inner = token.slice(1);
    const close = inner.indexOf("](");
    const alt = inner.slice(1, close);
    const url = inner.slice(close + 2, -1).trim();
    if (/^vela-img:\/\//i.test(url)) {
        return `<img data-vela-img="${url.slice("vela-img://".length)}" alt="${alt}" loading="lazy" />`;
    }
    if (!/^(data:image\/|https:\/\/)/i.test(url)) return token;
    return `<img src="${url}" alt="${alt}" loading="lazy" />`;
}

// Tokenizes inline markdown. The input has already been HTML-escaped, so matched
// tokens are safe to wrap directly in tags. Code spans are matched first so
// markdown characters inside them are never reinterpreted.
const INLINE_RE =
    /(`[^`\n]+`)|(!\[[^\]]*\]\([^)\n]*\))|(\[[^\]]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)/g;

function renderInline(line: string): string {
    const parts: string[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(line)) !== null) {
        if (m.index > last) parts.push(line.slice(last, m.index));
        const token = m[0];
        if (token.startsWith("`")) {
            parts.push(`<code>${token.slice(1, -1)}</code>`);
        } else if (token.startsWith("![")) {
            parts.push(renderImageToken(token));
        } else if (token.startsWith("[")) {
            parts.push(renderLinkToken(token));
        } else if (token.startsWith("**")) {
            parts.push(`<strong>${token.slice(2, -2)}</strong>`);
        } else if (token.startsWith("~~")) {
            parts.push(`<del>${token.slice(2, -2)}</del>`);
        } else {
            parts.push(`<em>${token.slice(1, -1)}</em>`);
        }
        last = INLINE_RE.lastIndex;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts.join("");
}

function isBlockStart(line: string): boolean {
    return (
        /^(#{1,3}\s|```|>\s?|[-*]\s+|\d+\.\s+|\|)/.test(line) ||
        /^(-{3,}|\*{3,})\s*$/.test(line)
    );
}

/** Render a markdown source string to sanitized HTML. */
export function renderMarkdown(src: string): string {
    const lines = src.split(/\r?\n/);
    const blocks: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i]!;

        // Blank line: paragraph separator.
        if (/^\s*$/.test(line)) {
            i += 1;
            continue;
        }

        // Fenced code block.
        if (/^```/.test(line)) {
            const buf: string[] = [];
            i += 1;
            while (i < lines.length && !/^```/.test(lines[i]!)) {
                buf.push(lines[i]!);
                i += 1;
            }
            i += 1; // skip the closing fence
            blocks.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
            continue;
        }

        // Headings (h1–h3).
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
            const level = heading[1]!.length;
            blocks.push(`<h${level}>${renderInline(escapeHtml(heading[2]!))}</h${level}>`);
            i += 1;
            continue;
        }

        // Horizontal rule.
        if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
            blocks.push("<hr />");
            i += 1;
            continue;
        }

        // Blockquote: consecutive `> ` lines become one quote block.
        if (/^>\s?/.test(line)) {
            const buf: string[] = [];
            while (i < lines.length && /^>\s?/.test(lines[i]!)) {
                buf.push(escapeHtml(lines[i]!.replace(/^>\s?/, "")));
                i += 1;
            }
            blocks.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
            continue;
        }

        // Unordered list.
        if (/^[-*]\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
                items.push(renderInline(escapeHtml(lines[i]!.replace(/^[-*]\s+/, ""))));
                i += 1;
            }
            blocks.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
            continue;
        }

        // Ordered list.
        if (/^\d+\.\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
                items.push(renderInline(escapeHtml(lines[i]!.replace(/^\d+\.\s+/, ""))));
                i += 1;
            }
            blocks.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
            continue;
        }

        // Table: consecutive `|` lines, second row must be a `---` separator.
        if (/^\|/.test(line)) {
            const rows: string[][] = [];
            while (i < lines.length && /^\|/.test(lines[i]!)) {
                const row = lines[i]!.trim().replace(/^\|/, "").replace(/\|$/, "");
                rows.push(row.split("|").map((c) => c.trim()));
                i += 1;
            }
            if (rows.length >= 2 && rows[1]!.every((c) => /^:?-{1,}:?$/.test(c))) {
                const [header, ...body] = rows;
                const head = `<tr>${header!.map((c) => `<th>${renderInline(escapeHtml(c))}</th>`).join("")}</tr>`;
                const bodyHtml = body
                    .map((r) => `<tr>${r.map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join("")}</tr>`)
                    .join("");
                blocks.push(`<table><thead>${head}</thead><tbody>${bodyHtml}</tbody></table>`);
            } else {
                // Not a valid table → fall back to plain paragraphs.
                blocks.push(...rows.map((r) => `<p>${renderInline(escapeHtml(r.join(" | ")))}</p>`));
            }
            continue;
        }

        // Paragraph: collect until a blank line or another block start.
        const buf: string[] = [escapeHtml(line)];
        i += 1;
        while (i < lines.length && !/^\s*$/.test(lines[i]!) && !isBlockStart(lines[i]!)) {
            buf.push(escapeHtml(lines[i]!));
            i += 1;
        }
        blocks.push(`<p>${renderInline(buf.join("<br />"))}</p>`);
    }

    return blocks.join("\n");
}

/** Strip Markdown to a plain-text excerpt for plan cards. */
export function markdownToPlainText(md: string, maxLength = 120): string {
    const text = md
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*(#{1,6}\s+|>\s?|[-*]\s+|\d+\.\s+)/gm, "")
        .replace(/[`*_~]/g, "")
        .replace(/\|/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** First `![alt](src)` image src, or null. Used for plan-card thumbnails. */
export function extractFirstImage(md: string): string | null {
    const m = /!\[[^\]]*\]\(([^)]+)\)/.exec(md);
    return m ? m[1]! : null;
}