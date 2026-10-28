// Trade-plan feature panel.
//
// Lets the user turn the active K-line cell into a Markdown trade plan: click
// 「用当前图表新建」captures the cell's chart (drawings included) as a PNG, stores
// it in the dedicated image store (so the markdown stays compact with short
// `vela-img://` references), pre-fills a 目标 / 入场理由 / 退出底线 template, then
// the plan is edited in a split editor (left Markdown source, right live
// preview). Single-click「编辑」opens the editor; double-clicking a plan card opens
// a read-only view. Plans persist to a dedicated IndexedDB database
// (docs/plans/trade-plan.md).

import "./tradePlan.css";
import { formatPlanId, formatPlanStockLabel, formatPlanTimestamp, uniquePlanId } from "./format";
import { createImageStore, extractImageIds } from "./images";
import { extractFirstImage, markdownToPlainText, renderMarkdown } from "./markdown";
import { TRADE_PLAN_PAGE_SIZE, filterPlans, paginate } from "./paging";
import { createTradePlanStore } from "./store";
import type { ImageStore, TradePlan, TradePlanStore } from "./types";

export interface TradePlanOptions {
    /** Capture the active K-line cell (ticker + coin name + chart screenshot). */
    getActiveChart: () => { ticker: string; name: string; screenshot: string | null } | null;
}

const TEMPLATE = `## 目标

（写下目标价 / 预期走势）

## 入场理由

（写下入场依据）

## 退出底线

（写下退出底线）
`;

interface UiEls {
    list: HTMLDivElement;
    editor: HTMLDivElement;
    newBtn: HTMLButtonElement;
    refreshBtn: HTMLButtonElement;
    backBtn: HTMLButtonElement;
    saveBtn: HTMLButtonElement;
    editBtn: HTMLButtonElement;
    insertImageBtn: HTMLButtonElement;
    imageFile: HTMLInputElement;
    editorId: HTMLSpanElement;
    status: HTMLSpanElement;
    message: HTMLSpanElement;
    textarea: HTMLTextAreaElement;
    preview: HTMLDivElement;
    searchInput: HTMLInputElement;
    pagePrev: HTMLButtonElement;
    pageNext: HTMLButtonElement;
    pageInfo: HTMLSpanElement;
}

let els: UiEls | null = null;
let options: TradePlanOptions | null = null;
let store: TradePlanStore = createTradePlanStore();
let imageStore: ImageStore = createImageStore();
let plans: TradePlan[] = [];
let editingId: string | null = null;
let viewMode: "edit" | "read" = "edit";
let previewTimer: number | null = null;
let messageTimer: number | null = null;
let lastSavedAt: number | null = null;
let searchQuery = "";
let currentPage = 1;

function getEls(): UiEls {
    if (els) return els;
    els = {
        list: document.getElementById("trade-plan-list") as HTMLDivElement,
        editor: document.getElementById("trade-plan-editor") as HTMLDivElement,
        newBtn: document.getElementById("trade-plan-new") as HTMLButtonElement,
        refreshBtn: document.getElementById("trade-plan-refresh") as HTMLButtonElement,
        backBtn: document.getElementById("trade-plan-back") as HTMLButtonElement,
        saveBtn: document.getElementById("trade-plan-save") as HTMLButtonElement,
        editBtn: document.getElementById("trade-plan-edit") as HTMLButtonElement,
        insertImageBtn: document.getElementById("trade-plan-insert-image") as HTMLButtonElement,
        imageFile: document.getElementById("trade-plan-image-file") as HTMLInputElement,
        editorId: document.getElementById("trade-plan-editor-id") as HTMLSpanElement,
        status: document.getElementById("trade-plan-editor-status") as HTMLSpanElement,
        message: document.getElementById("trade-plan-message") as HTMLSpanElement,
        textarea: document.getElementById("trade-plan-markdown") as HTMLTextAreaElement,
        preview: document.getElementById("trade-plan-preview") as HTMLDivElement,
        searchInput: document.getElementById("trade-plan-search") as HTMLInputElement,
        pagePrev: document.getElementById("trade-plan-page-prev") as HTMLButtonElement,
        pageNext: document.getElementById("trade-plan-page-next") as HTMLButtonElement,
        pageInfo: document.getElementById("trade-plan-page-info") as HTMLSpanElement,
    };
    return els;
}

/** Show a transient message in the always-visible plan toolbar. */
function showMessage(text: string): void {
    const { message } = getEls();
    message.textContent = text;
    if (messageTimer !== null) window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => {
        message.textContent = "";
        messageTimer = null;
    }, 4000);
}

function setEditorVisible(visible: boolean): void {
    const { list, editor } = getEls();
    list.hidden = visible;
    editor.hidden = !visible;
}

/** Switch between the read-only preview and the editable split view. */
function setViewMode(mode: "edit" | "read"): void {
    viewMode = mode;
    const { editor, editBtn, saveBtn } = getEls();
    editor.classList.toggle("readonly", mode === "read");
    editBtn.hidden = mode !== "read";
    saveBtn.hidden = mode !== "edit";
}

/** Replace `data-vela-img` placeholders with real data URLs from the image store. */
async function resolveImageSrcs(container: HTMLElement): Promise<void> {
    const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("img[data-vela-img]"));
    await Promise.all(
        imgs.map(async (img) => {
            const id = img.dataset.velaImg;
            if (!id) return;
            const url = await imageStore.get(id);
            if (url) {
                img.src = url;
                img.removeAttribute("data-vela-img");
            } else {
                img.remove();
            }
        }),
    );
}

function renderPager(total: number, totalPages: number): void {
    const { pagePrev, pageNext, pageInfo } = getEls();
    pagePrev.disabled = total === 0 || currentPage <= 1;
    pageNext.disabled = total === 0 || currentPage >= totalPages;
    pageInfo.textContent = total ? `第 ${currentPage} / ${totalPages} 页 · 共 ${total} 条` : "";
}

function renderList(): void {
    const { list } = getEls();
    const filtered = filterPlans(plans, searchQuery);
    const { pageItems, totalPages, page } = paginate(filtered, currentPage, TRADE_PLAN_PAGE_SIZE);
    currentPage = page;
    list.textContent = "";
    if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "trade-plan-empty";
        empty.textContent = plans.length
            ? `没有找到匹配「${searchQuery.trim()}」的计划。`
            : "还没有交易计划。选中一个币种并画好线，点「＋ 用当前图表新建」生成第一份计划。";
        list.appendChild(empty);
        renderPager(0, 1);
        return;
    }
    for (const plan of pageItems) {
        list.appendChild(buildPlanCard(plan));
    }
    renderPager(filtered.length, totalPages);
}

function buildPlanCard(plan: TradePlan): HTMLElement {
    const card = document.createElement("article");
    card.className = "trade-plan-card";
    card.dataset.planId = plan.id;
    card.title = "双击查看";

    const thumb = document.createElement("div");
    thumb.className = "trade-plan-card-thumb";
    const imgSrc = extractFirstImage(plan.markdown);
    if (imgSrc) {
        const img = document.createElement("img");
        img.alt = `${plan.ticker} 图表缩略图`;
        img.loading = "lazy";
        thumb.appendChild(img);
        if (imgSrc.startsWith("vela-img://")) {
            void imageStore.get(imgSrc.slice("vela-img://".length)).then((url) => {
                if (url) img.src = url;
                else img.remove();
            });
        } else {
            img.src = imgSrc;
        }
    } else {
        thumb.classList.add("placeholder");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("width", "22");
        icon.setAttribute("height", "22");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("fill", "none");
        icon.setAttribute("stroke", "currentColor");
        icon.setAttribute("stroke-width", "1.6");
        icon.setAttribute("stroke-linecap", "round");
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML =
            '<path d="M4 19V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/>' +
            '<path d="M8 15l3-4 3 3 2-2"/>';
        thumb.appendChild(icon);
    }

    const body = document.createElement("div");
    body.className = "trade-plan-card-body";

    const idEl = document.createElement("div");
    idEl.className = "trade-plan-card-id";
    idEl.textContent = plan.id;

    const meta = document.createElement("div");
    meta.className = "trade-plan-card-meta";
    meta.textContent = `${formatPlanStockLabel(plan)} · 更新于 ${formatPlanTimestamp(plan.updatedAt)}`;

    const excerpt = document.createElement("div");
    excerpt.className = "trade-plan-card-excerpt";
    excerpt.textContent = markdownToPlainText(plan.markdown);

    body.append(idEl, meta, excerpt);

    const actions = document.createElement("div");
    actions.className = "trade-plan-card-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "trade-plan-card-edit";
    editBtn.dataset.action = "edit";
    editBtn.textContent = "编辑";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "trade-plan-card-delete";
    deleteBtn.dataset.action = "delete";
    deleteBtn.textContent = "删除";
    actions.append(editBtn, deleteBtn);

    card.append(thumb, body, actions);
    return card;
}

function renderPreview(): void {
    const { textarea, preview, status } = getEls();
    preview.innerHTML = renderMarkdown(textarea.value);
    void resolveImageSrcs(preview);
    const words = textarea.value.replace(/\s+/g, "").length;
    const images =
        extractImageIds(textarea.value).length +
        (textarea.value.match(/!\[[^\]]*\]\(data:image\//g) ?? []).length;
    const saved = lastSavedAt ? ` · 已保存 ${formatPlanTimestamp(lastSavedAt)}` : "";
    status.textContent = `字数 ${words} · 图片 ${images}${saved}`;
}

function schedulePreview(): void {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
        previewTimer = null;
        renderPreview();
    }, 100);
}

function openEditor(plan: TradePlan): void {
    editingId = plan.id;
    lastSavedAt = plan.updatedAt;
    const { editorId, textarea } = getEls();
    editorId.textContent = plan.id;
    textarea.value = plan.markdown;
    setViewMode("edit");
    setEditorVisible(true);
    renderPreview();
    textarea.focus();
}

/** Open a plan in read-only mode (double-click on a card). */
function openReadonly(plan: TradePlan): void {
    editingId = plan.id;
    lastSavedAt = plan.updatedAt;
    const { editorId, textarea } = getEls();
    editorId.textContent = plan.id;
    textarea.value = plan.markdown;
    setViewMode("read");
    setEditorVisible(true);
    renderPreview();
}

function showList(): void {
    editingId = null;
    viewMode = "edit";
    setEditorVisible(false);
    renderList();
}

async function refreshList(): Promise<void> {
    plans = await store.list();
    currentPage = 1;
    renderList();
}

async function saveCurrentPlan(): Promise<void> {
    const plan = plans.find((p) => p.id === editingId);
    if (!plan) return;
    const { textarea } = getEls();
    const updated = { ...plan, markdown: textarea.value, updatedAt: Date.now() };
    await store.save(updated);
    plans = plans.map((p) => (p.id === updated.id ? updated : p));
    lastSavedAt = updated.updatedAt;
    renderPreview();
}

async function createNewPlan(): Promise<void> {
    if (!options) return;
    const chart = options.getActiveChart();
    const { newBtn } = getEls();
    if (!chart) {
        showMessage("请先在 K 线大屏选中一个币种，再新建交易计划。");
        return;
    }
    newBtn.disabled = true;
    try {
        const now = new Date();
        const baseId = formatPlanId(now, chart.ticker, chart.name);
        const id = uniquePlanId(
            baseId,
            plans.map((p) => p.id),
        );
        let imageLine = "";
        if (chart.screenshot) {
            const imageId = await imageStore.save(chart.screenshot);
            imageLine = `![${chart.ticker} ${chart.name} 图表](vela-img://${imageId})\n\n`;
        }
        const plan: TradePlan = {
            id,
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
            ticker: chart.ticker,
            name: chart.name,
            markdown: `${imageLine}${TEMPLATE}`,
        };
        await store.save(plan);
        await refreshList();
        openEditor(plan);
    } finally {
        newBtn.disabled = false;
    }
}

async function deletePlan(id: string): Promise<void> {
    const plan = plans.find((p) => p.id === id);
    if (!plan) return;
    if (!window.confirm(`确定删除交易计划「${plan.id}」？删除后不可恢复。`)) return;
    await store.remove(id);
    // Only delete images that no remaining plan still references.
    const remaining = new Set(
        plans.filter((p) => p.id !== id).flatMap((p) => extractImageIds(p.markdown)),
    );
    const orphanIds = extractImageIds(plan.markdown).filter((imgId) => !remaining.has(imgId));
    if (orphanIds.length) await imageStore.delete(orphanIds);
    if (editingId === id) showList();
    await refreshList();
}

/** Insert text at the textarea's cursor (replacing any selection). */
function insertAtCursor(text: string): void {
    const { textarea } = getEls();
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
    const cursor = start + text.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.focus();
    renderPreview();
}

/** Wrap the selection (or a placeholder) with `before`/`after` markers. */
function wrapSelection(before: string, after: string, placeholder: string): void {
    const { textarea } = getEls();
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const selected = textarea.value.slice(start, end);
    const content = selected || placeholder;
    const inserted = `${before}${content}${after}`;
    textarea.value = `${textarea.value.slice(0, start)}${inserted}${textarea.value.slice(end)}`;
    const cursor = selected ? start + inserted.length : start + before.length + placeholder.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.focus();
    renderPreview();
}

/** Toggle a line-level markdown prefix (heading / quote / list item). */
function toggleLinePrefix(insert: string, match: RegExp, placeholder: string): void {
    const { textarea } = getEls();
    const start = textarea.selectionStart ?? textarea.value.length;
    const value = textarea.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = value.indexOf("\n", start);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const line = value.slice(lineStart, lineEnd);
    const existing = line.match(match)?.[0];
    if (existing) {
        textarea.value = value.slice(0, lineStart) + line.slice(existing.length) + value.slice(lineEnd);
        const cursor = Math.max(lineStart, start - existing.length);
        textarea.selectionStart = cursor;
        textarea.selectionEnd = cursor;
    } else {
        textarea.value = value.slice(0, lineStart) + insert + line + value.slice(lineEnd);
        const cursor = start + insert.length;
        textarea.selectionStart = cursor;
        textarea.selectionEnd = cursor;
    }
    textarea.focus();
    renderPreview();
}

/** Insert a fenced code block, wrapping the selection when present. */
function insertFencedCode(): void {
    const { textarea } = getEls();
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const selected = textarea.value.slice(start, end) || "代码";
    const atLineStart = start === 0 || textarea.value[start - 1] === "\n";
    const inserted = `${atLineStart ? "" : "\n"}\`\`\`\n${selected}\n\`\`\`\n\n`;
    textarea.value = `${textarea.value.slice(0, start)}${inserted}${textarea.value.slice(end)}`;
    const cursor = start + inserted.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.focus();
    renderPreview();
}

/** Insert a link `[文本](https://)` and select the URL for pasting. */
function insertLink(): void {
    const { textarea } = getEls();
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const label = textarea.value.slice(start, end).trim() || "链接文本";
    const inserted = `[${label}](https://)`;
    textarea.value = `${textarea.value.slice(0, start)}${inserted}${textarea.value.slice(end)}`;
    const urlStart = start + inserted.lastIndexOf("(") + 1;
    const urlEnd = start + inserted.length - 1;
    textarea.selectionStart = urlStart;
    textarea.selectionEnd = urlEnd;
    textarea.focus();
    renderPreview();
}

/** Insert a horizontal rule on its own line. */
function insertHr(): void {
    const { textarea } = getEls();
    const start = textarea.selectionStart ?? textarea.value.length;
    const value = textarea.value;
    const atLineStart = start === 0 || value[start - 1] === "\n";
    const inserted = `${atLineStart ? "" : "\n"}---\n\n`;
    textarea.value = `${value.slice(0, start)}${inserted}${value.slice(start)}`;
    const cursor = start + inserted.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.focus();
    renderPreview();
}

/** Insert a two-column markdown table. */
function insertTable(): void {
    const { textarea } = getEls();
    const start = textarea.selectionStart ?? textarea.value.length;
    const value = textarea.value;
    const atLineStart = start === 0 || value[start - 1] === "\n";
    const inserted = `${atLineStart ? "" : "\n"}| 列1 | 列2 |\n| --- | --- |\n|  |  |\n\n`;
    textarea.value = `${value.slice(0, start)}${inserted}${value.slice(start)}`;
    const cursor = start + inserted.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.focus();
    renderPreview();
}

function insertImageAsDataUrl(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : null;
        if (!url) return;
        void imageStore.save(url).then((id) => {
            insertAtCursor(`![图片](vela-img://${id})\n\n`);
        });
    };
    reader.readAsDataURL(file);
}

function handlePastedImage(clipboardData: DataTransfer | null): void {
    if (!clipboardData) return;
    const file = Array.from(clipboardData.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .find((f): f is File => f !== null);
    if (file) {
        insertImageAsDataUrl(file);
    }
}

export function initTradePlan(opts: TradePlanOptions): void {
    options = opts;
    const {
        newBtn,
        refreshBtn,
        backBtn,
        saveBtn,
        editBtn,
        insertImageBtn,
        imageFile,
        textarea,
        preview,
        list,
        searchInput,
        pagePrev,
        pageNext,
    } = getEls();

    newBtn.addEventListener("click", () => void createNewPlan());
    refreshBtn.addEventListener("click", () => void refreshList());
    backBtn.addEventListener("click", () => {
        if (viewMode === "edit") {
            void saveCurrentPlan().then(showList);
        } else {
            showList();
        }
    });
    saveBtn.addEventListener("click", () => {
        void saveCurrentPlan().then(showList);
    });
    editBtn.addEventListener("click", () => {
        const plan = plans.find((p) => p.id === editingId);
        if (plan) openEditor(plan);
    });
    searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value;
        currentPage = 1;
        renderList();
    });
    pagePrev.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage -= 1;
            renderList();
        }
    });
    pageNext.addEventListener("click", () => {
        const filtered = filterPlans(plans, searchQuery);
        const { totalPages } = paginate(filtered, currentPage, TRADE_PLAN_PAGE_SIZE);
        if (currentPage < totalPages) {
            currentPage += 1;
            renderList();
        }
    });
    insertImageBtn.addEventListener("click", () => imageFile.click());
    imageFile.addEventListener("change", () => {
        const file = imageFile.files?.[0];
        if (file) insertImageAsDataUrl(file);
        imageFile.value = "";
    });
    textarea.addEventListener("input", schedulePreview);
    textarea.addEventListener("paste", (e) => {
        if (e.clipboardData && Array.from(e.clipboardData.items).some((i) => i.kind === "file" && i.type.startsWith("image/"))) {
            e.preventDefault();
            handlePastedImage(e.clipboardData);
        }
    });
    textarea.addEventListener("dragover", (e) => e.preventDefault());
    textarea.addEventListener("drop", (e) => {
        e.preventDefault();
        const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (file) insertImageAsDataUrl(file);
    });

    // Toolbar: markdown formatting actions.
    const editorToolbar = document.querySelector<HTMLElement>(".trade-plan-editor-toolbar");
    editorToolbar?.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-md-action]");
        if (!btn) return;
        switch (btn.dataset.mdAction) {
            case "bold":
                wrapSelection("**", "**", "加粗文本");
                break;
            case "italic":
                wrapSelection("*", "*", "斜体文本");
                break;
            case "strike":
                wrapSelection("~~", "~~", "删除线文本");
                break;
            case "code":
                wrapSelection("`", "`", "行内代码");
                break;
            case "heading":
                toggleLinePrefix("## ", /^#{1,6}\s+/, "标题");
                break;
            case "quote":
                toggleLinePrefix("> ", /^>\s?/, "引用文本");
                break;
            case "ul":
                toggleLinePrefix("- ", /^[-*]\s+/, "列表项");
                break;
            case "ol":
                toggleLinePrefix("1. ", /^\d+\.\s+/, "列表项");
                break;
            case "codeblock":
                insertFencedCode();
                break;
            case "link":
                insertLink();
                break;
            case "hr":
                insertHr();
                break;
            case "table":
                insertTable();
                break;
        }
    });

    // Click delegation for card actions (edit / delete).
    list.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
        if (!btn) return;
        const id = btn.closest<HTMLElement>(".trade-plan-card")?.dataset.planId;
        if (!id) return;
        if (btn.dataset.action === "edit") {
            const plan = plans.find((p) => p.id === id);
            if (plan) openEditor(plan);
        } else if (btn.dataset.action === "delete") {
            void deletePlan(id);
        }
    });

    // Double-click on a card (not its buttons) opens a read-only view.
    list.addEventListener("dblclick", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const card = (e.target as HTMLElement).closest<HTMLElement>(".trade-plan-card");
        if (!card?.dataset.planId) return;
        const plan = plans.find((p) => p.id === card.dataset.planId);
        if (plan) openReadonly(plan);
    });

    // The editor split-view resizes with a draggable divider.
    const divider = document.getElementById("trade-plan-editor-divider");
    divider?.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startLeft = textarea.getBoundingClientRect().width;
        const onMove = (ev: PointerEvent): void => {
            const delta = ev.clientX - startX;
            const width = Math.max(160, Math.min(1600, startLeft + delta));
            textarea.style.flex = `1 1 ${width}px`;
            preview.style.flex = "1 1 0";
        };
        const onUp = (): void => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    });

    void refreshList();
}