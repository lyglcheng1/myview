// Pine coin-screener feature panel.
//
// Runs a saved Pine script headlessly over the WHOLE Binance USDT spot
// universe using the worker-backed Pine engine (`PineWorkerEngine`), the
// IndexedDB daily-bar cache and the Binance symbol list. The script marks
// matches via `plot(cond ? 1 : 0, "signal")`; the scan reads the last bar's
// signal value. The result table is clickable — clicking a row opens that
// coin in the K-line grid. Completed scans are auto-saved with a timestamp and
// can be reviewed, re-run or deleted from the「历史扫描」bar
// (docs/plans/pine-scripting.md).

import "./pineScreener.css";
import { PineWorkerEngine } from "@luxalgo/vela-pinets";
import type { InputSchema, InputValue, PreparedScript } from "../../src";
import { dashboardStorage } from "../idbStorage";
import { addScanToHistory, loadScanHistory, persistScanHistory, removeScanFromHistory } from "./history";
import type { SavedScan } from "./history";
import { createKlineStore } from "./klineStore";
import { createScreenerDataSource } from "./binance";
import { DEFAULT_SIGNAL_PLOT, runScan } from "./scan";
import type { ScanMarket, ScanProgress, ScanResult } from "./types";

const PINE_KEY = "vela-dashboard-pine-scripts";
const DEFAULT_HISTORY_BARS = 500;
const HISTORY_MIN = 60;
const HISTORY_MAX = 2000;

export interface PineScreenerOptions {
    /** Open a matched coin in the K-line grid. */
    onOpenSymbol: (ticker: string) => void;
}

interface PineScriptEntry {
    id: string;
    name: string;
    source: string;
}

interface UiEls {
    scriptSelect: HTMLSelectElement;
    marketSelect: HTMLSelectElement;
    historyInput: HTMLInputElement;
    startBtn: HTMLButtonElement;
    stopBtn: HTMLButtonElement;
    inputsEl: HTMLDivElement;
    progressEl: HTMLDivElement;
    progressFill: HTMLDivElement;
    statusEl: HTMLSpanElement;
    summaryEl: HTMLDivElement;
    resultsEl: HTMLTableElement;
    resultsBody: HTMLTableSectionElement;
    emptyEl: HTMLDivElement;
    historySelect: HTMLSelectElement;
    historyRerunBtn: HTMLButtonElement;
    historyDeleteBtn: HTMLButtonElement;
}

let els: UiEls | null = null;
let initialized = false;
let running = false;
let stopRequested = false;
let engine: PineWorkerEngine | null = null;
let currentScript: PineScriptEntry | null = null;
let prepared: PreparedScript | null = null;
let inputsSchema: InputSchema[] = [];
let scanHistory: SavedScan[] = [];
let selectedHistoryId: string | null = null;

function getEls(): UiEls {
    if (els) return els;
    els = {
        scriptSelect: document.getElementById("screener-script-select") as HTMLSelectElement,
        marketSelect: document.getElementById("screener-market") as HTMLSelectElement,
        historyInput: document.getElementById("screener-history") as HTMLInputElement,
        startBtn: document.getElementById("screener-start") as HTMLButtonElement,
        stopBtn: document.getElementById("screener-stop") as HTMLButtonElement,
        inputsEl: document.getElementById("screener-inputs") as HTMLDivElement,
        progressEl: document.getElementById("screener-progress") as HTMLDivElement,
        progressFill: document.getElementById("screener-progress-fill") as HTMLDivElement,
        statusEl: document.getElementById("screener-status") as HTMLSpanElement,
        summaryEl: document.getElementById("screener-summary") as HTMLDivElement,
        resultsEl: document.getElementById("screener-results") as HTMLTableElement,
        resultsBody: document.getElementById("screener-results-body") as HTMLTableSectionElement,
        emptyEl: document.getElementById("screener-empty") as HTMLDivElement,
        historySelect: document.getElementById("screener-history-select") as HTMLSelectElement,
        historyRerunBtn: document.getElementById("screener-history-rerun") as HTMLButtonElement,
        historyDeleteBtn: document.getElementById("screener-history-delete") as HTMLButtonElement,
    };
    return els;
}

function loadPineScripts(): PineScriptEntry[] {
    try {
        const raw = dashboardStorage.getItem(PINE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as PineScriptEntry[];
            if (Array.isArray(parsed)) return parsed.filter((s) => s && typeof s.id === "string" && typeof s.source === "string");
        }
    } catch {
        /* corrupted storage → empty */
    }
    return [];
}

function renderScriptSelect(scripts: PineScriptEntry[]): void {
    const { scriptSelect } = getEls();
    scriptSelect.innerHTML = "";
    if (!scripts.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "暂无脚本（先在 Pine 编辑器保存）";
        scriptSelect.appendChild(opt);
        scriptSelect.disabled = true;
        return;
    }
    scriptSelect.disabled = false;
    for (const script of scripts) {
        const opt = document.createElement("option");
        opt.value = script.id;
        opt.textContent = script.name;
        opt.title = script.name;
        scriptSelect.appendChild(opt);
    }
    if (currentScript && scripts.some((s) => s.id === currentScript!.id)) {
        scriptSelect.value = currentScript.id;
    } else {
        currentScript = scripts[0]!;
        scriptSelect.value = currentScript.id;
    }
}

/** Parse the selected script once so the parameter form can be rendered. */
async function prepareCurrentScript(): Promise<void> {
    const { statusEl } = getEls();
    if (!currentScript) {
        prepared = null;
        inputsSchema = [];
        renderInputs();
        return;
    }
    try {
        engine ??= new PineWorkerEngine();
        prepared = await engine.prepare(currentScript.source, "pine-screener");
        inputsSchema = prepared.inputs ?? [];
        renderInputs();
        setStatusText("");
        statusEl.className = "screener-status";
    } catch (e) {
        prepared = null;
        inputsSchema = [];
        renderInputs();
        const message = e instanceof Error ? e.message : String(e);
        setStatusText(`脚本解析失败：${message}`);
        statusEl.className = "screener-status error";
    }
}

function inputLabel(schema: InputSchema): string {
    return schema.title || schema.key;
}

function buildInputControl(schema: InputSchema): HTMLElement {
    const wrap = document.createElement("label");
    wrap.className = "screener-input";
    const label = document.createElement("span");
    label.textContent = inputLabel(schema);
    wrap.appendChild(label);

    switch (schema.type) {
        case "bool": {
            const input = document.createElement("input");
            input.type = "checkbox";
            input.dataset.key = schema.key;
            input.checked = Boolean(schema.defval);
            wrap.appendChild(input);
            break;
        }
        case "int":
        case "float": {
            const input = document.createElement("input");
            input.type = "number";
            input.dataset.key = schema.key;
            input.step = schema.step !== undefined ? String(schema.step) : schema.type === "int" ? "1" : "any";
            if (schema.min !== undefined) input.min = String(schema.min);
            if (schema.max !== undefined) input.max = String(schema.max);
            input.value = String(schema.defval);
            wrap.appendChild(input);
            break;
        }
        case "source": {
            const select = document.createElement("select");
            select.dataset.key = schema.key;
            const sources = ["open", "high", "low", "close", "volume"];
            for (const src of sources) {
                const opt = document.createElement("option");
                opt.value = src;
                opt.textContent = src;
                select.appendChild(opt);
            }
            select.value = String(schema.defval);
            wrap.appendChild(select);
            break;
        }
        case "color": {
            const input = document.createElement("input");
            input.type = "color";
            input.dataset.key = schema.key;
            input.value = String(schema.defval || "#2962ff");
            wrap.appendChild(input);
            break;
        }
        case "string":
            if (schema.options?.length) {
                const select = document.createElement("select");
                select.dataset.key = schema.key;
                for (const optValue of schema.options) {
                    const opt = document.createElement("option");
                    opt.value = optValue;
                    opt.textContent = optValue;
                    select.appendChild(opt);
                }
                select.value = String(schema.defval);
                wrap.appendChild(select);
            } else {
                const input = document.createElement("input");
                input.type = "text";
                input.dataset.key = schema.key;
                input.value = String(schema.defval);
                wrap.appendChild(input);
            }
            break;
        default: {
            // session / timeframe / symbol / price / time / text_area — free text.
            const input = document.createElement("input");
            input.type = "text";
            input.dataset.key = schema.key;
            input.value = String(schema.defval);
            wrap.appendChild(input);
        }
    }
    return wrap;
}

function renderInputs(): void {
    const { inputsEl } = getEls();
    inputsEl.innerHTML = "";
    if (!inputsSchema.length) {
        inputsEl.hidden = true;
        return;
    }
    inputsEl.hidden = false;
    for (const schema of inputsSchema) {
        inputsEl.appendChild(buildInputControl(schema));
    }
}

function collectInputs(): Record<string, InputValue> {
    const values: Record<string, InputValue> = {};
    const { inputsEl } = getEls();
    for (const control of inputsEl.querySelectorAll<HTMLElement>(".screener-input")) {
        const input = control.querySelector<HTMLInputElement | HTMLSelectElement>("input[data-key], select[data-key]");
        if (!input) continue;
        const key = input.dataset.key!;
        if (input instanceof HTMLInputElement) {
            if (input.type === "checkbox") values[key] = input.checked;
            else if (input.type === "number") values[key] = Number(input.value);
            else values[key] = input.value;
        } else {
            values[key] = input.value;
        }
    }
    return values;
}

// Render a plain-text status. The scanning state additionally renders a
// fixed-width count slot (see renderProgress); every other state uses a single
// lead span so long messages truncate with an ellipsis instead of overflowing
// the progress bar.
function setStatusText(text: string): void {
    const { statusEl } = getEls();
    const leadEl = document.createElement("span");
    leadEl.className = "screener-status-lead";
    leadEl.textContent = text;
    statusEl.replaceChildren(leadEl);
}

function setStatus(message: string, kind: "ok" | "error" | "" = ""): void {
    const { statusEl } = getEls();
    setStatusText(message);
    statusEl.className = kind ? `screener-status ${kind}` : "screener-status";
}

// Progress events fire once per coin (~400+ over a full scan) — coalesce the
// DOM updates to one per animation frame.
let pendingProgress: ScanProgress | null = null;
let progressFrame: number | null = null;

function scheduleProgress(p: ScanProgress): void {
    pendingProgress = p;
    if (progressFrame !== null) return;
    progressFrame = requestAnimationFrame(() => {
        progressFrame = null;
        const next = pendingProgress;
        pendingProgress = null;
        if (next) renderProgress(next);
    });
}

function renderProgress(p: ScanProgress): void {
    const { progressFill, statusEl } = getEls();
    const pct = p.total > 0 ? (p.done / p.total) * 100 : 0;
    progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    switch (p.phase) {
        case "preparing":
            setStatusText("正在解析 Pine 脚本…");
            statusEl.className = "screener-status";
            break;
        case "listing":
            setStatusText("正在拉取交易对列表…");
            statusEl.className = "screener-status";
            break;
        case "scanning": {
            // The coin name leads the line and the `done/total` count lives in a
            // fixed-width right-aligned slot, so the numbers do not shift as the
            // coin name's length changes.
            const lead = p.currentTicker
                ? `正在扫描 ${p.currentName} ${p.currentTicker} · 命中 ${p.matched}`
                : `正在扫描 · 命中 ${p.matched}`;
            const leadEl = document.createElement("span");
            leadEl.className = "screener-status-lead";
            leadEl.textContent = lead;
            const countEl = document.createElement("span");
            countEl.className = "screener-status-count";
            countEl.textContent = `${p.done}/${p.total}`;
            statusEl.replaceChildren(leadEl, countEl);
            statusEl.className = "screener-status";
            break;
        }
        case "done":
            setStatusText(`扫描完成：${p.total} 只币，命中 ${p.matched} 只币`);
            statusEl.className = "screener-status ok";
            break;
        case "cancelled":
            setStatusText(`已停止：扫描 ${p.done}/${p.total}，命中 ${p.matched} 只币`);
            statusEl.className = "screener-status";
            break;
        case "error":
            setStatusText(`扫描失败：${p.message ?? "未知错误"}`);
            statusEl.className = "screener-status error";
            break;
    }
}

function resetResultsView(): void {
    const { resultsEl, resultsBody, summaryEl, emptyEl, progressEl, progressFill, statusEl } = getEls();
    resultsEl.hidden = true;
    resultsBody.innerHTML = "";
    summaryEl.hidden = true;
    summaryEl.textContent = "";
    emptyEl.hidden = false;
    emptyEl.textContent = "扫描中，请稍候…";
    progressEl.hidden = false;
    progressFill.style.width = "0%";
    setStatusText("");
    statusEl.className = "screener-status";
}

function renderResults(results: ScanResult[], scan?: SavedScan): void {
    const { progressEl, resultsEl, summaryEl, emptyEl, statusEl } = getEls();
    progressEl.hidden = true;
    if (!results.length) {
        emptyEl.hidden = false;
        emptyEl.textContent = scan
            ? `${formatScanDate(scan.createdAt)} · ${marketLabel(scan.market)} · ${scan.scriptName} · 扫描 ${scan.total} 只币，没有符合条件的结果。`
            : "扫描完成，没有符合条件的结果（signal 全部为 0）。";
        return;
    }
    emptyEl.hidden = true;
    summaryEl.hidden = false;
    summaryEl.textContent = scan
        ? `${formatScanDate(scan.createdAt)} · ${marketLabel(scan.market)} · ${scan.scriptName} · 扫描 ${scan.total} 只币，共命中 ${results.length} 只币（点击行打开 K 线）`
        : `共命中 ${results.length} 只币（点击行打开 K 线）`;
    buildResultRows(results);
    resultsEl.hidden = false;
    setStatusText("");
    statusEl.className = "screener-status";
}

function formatSignal(value: number): string {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(4);
}

function escapeHtml(s: string): string {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

function formatScanDate(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function selectedScan(): SavedScan | null {
    return scanHistory.find((s) => s.id === selectedHistoryId) ?? null;
}

function refreshHistoryControls(): void {
    const { historySelect, historyRerunBtn, historyDeleteBtn } = getEls();
    historySelect.innerHTML = "";
    if (!scanHistory.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "暂无历史扫描";
        historySelect.appendChild(opt);
        historySelect.disabled = true;
        historyRerunBtn.disabled = true;
        historyDeleteBtn.disabled = true;
        selectedHistoryId = null;
        return;
    }
    for (const scan of scanHistory) {
        const opt = document.createElement("option");
        opt.value = scan.id;
        opt.textContent = `${formatScanDate(scan.createdAt)} · ${marketLabel(scan.market)} · 命中 ${scan.results.length} 只币 · ${scan.scriptName}`;
        opt.title = opt.textContent;
        historySelect.appendChild(opt);
    }
    if (!selectedHistoryId || !scanHistory.some((s) => s.id === selectedHistoryId)) {
        selectedHistoryId = scanHistory[scanHistory.length - 1]!.id;
    }
    historySelect.value = selectedHistoryId;
    historySelect.disabled = false;
    historyRerunBtn.disabled = false;
    historyDeleteBtn.disabled = false;
    // Render the pre-selected scan immediately so re-opening the screener (or
    // hydration) shows the latest saved results without requiring a change event.
    const selected = selectedScan();
    if (selected) renderSavedScan(selected);
}

function buildResultRows(results: ScanResult[]): void {
    const { resultsBody } = getEls();
    resultsBody.innerHTML = "";
    for (const r of results) {
        const tr = document.createElement("tr");
        tr.dataset.ticker = r.ticker;
        const changeClass = r.changePct > 0 ? "up" : r.changePct < 0 ? "down" : "";
        const changeText = `${r.changePct > 0 ? "+" : ""}${r.changePct.toFixed(2)}%`;
        tr.innerHTML = `
          <td class="screener-result-symbol">${r.ticker}</td>
          <td class="screener-result-name">${escapeHtml(r.name)}</td>
          <td class="screener-result-price">${r.price.toFixed(2)}</td>
          <td class="screener-result-change ${changeClass}">${changeText}</td>
          <td class="screener-result-signal">${formatSignal(r.signal)}</td>`;
        tr.addEventListener("click", () => {
            if (onOpenSymbol) onOpenSymbol(r.ticker);
        });
        resultsBody.appendChild(tr);
    }
}

function showSummary(text: string): void {
    const { summaryEl, emptyEl, resultsEl, resultsBody } = getEls();
    resultsEl.hidden = true;
    resultsBody.innerHTML = "";
    emptyEl.hidden = true;
    summaryEl.hidden = false;
    summaryEl.textContent = text;
}

function renderSavedScan(scan: SavedScan): void {
    const { progressEl, statusEl, resultsEl } = getEls();
    progressEl.hidden = true;
    setStatusText("");
    statusEl.className = "screener-status";
    if (!scan.results.length) {
        showSummary(`${formatScanDate(scan.createdAt)} · ${marketLabel(scan.market)} · ${scan.scriptName} · 扫描 ${scan.total} 只币，无命中`);
        return;
    }
    showSummary(
        `${formatScanDate(scan.createdAt)} · ${marketLabel(scan.market)} · ${scan.scriptName} · 扫描 ${scan.total} 只币，共命中 ${scan.results.length} 只币（点击行打开 K 线）`,
    );
    buildResultRows(scan.results);
    resultsEl.hidden = false;
}

function clearResultsView(): void {
    const { progressEl, resultsEl, resultsBody, summaryEl, emptyEl, statusEl } = getEls();
    progressEl.hidden = true;
    resultsEl.hidden = true;
    resultsBody.innerHTML = "";
    summaryEl.hidden = true;
    summaryEl.textContent = "";
    setStatusText("");
    statusEl.className = "screener-status";
    emptyEl.hidden = false;
    emptyEl.textContent = "选择脚本并设置参数后，点击「开始扫描」。";
}

function applyInputs(values: Record<string, InputValue>): void {
    const { inputsEl } = getEls();
    for (const control of inputsEl.querySelectorAll<HTMLElement>(".screener-input")) {
        const input = control.querySelector<HTMLInputElement | HTMLSelectElement>("input[data-key], select[data-key]");
        if (!input) continue;
        const key = input.dataset.key!;
        if (!(key in values)) continue;
        const value = values[key];
        if (input instanceof HTMLInputElement) {
            if (input.type === "checkbox") input.checked = Boolean(value);
            else if (input.type === "number") input.value = String(Number(value));
            else input.value = String(value);
        } else {
            input.value = String(value);
        }
    }
}

async function rerunScan(scan: SavedScan): Promise<void> {
    if (running) return;
    const scripts = loadPineScripts();
    const script = scripts.find((s) => s.id === scan.scriptId);
    if (!script) {
        setStatus("该扫描使用的脚本已被删除，无法重新扫描", "error");
        return;
    }
    currentScript = script;
    getEls().scriptSelect.value = script.id;
    getEls().marketSelect.value = scan.market ?? "spot";
    getEls().historyInput.value = String(scan.historyBars);
    await prepareCurrentScript();
    applyInputs(scan.inputs);
    await startScan();
}

async function startScan(): Promise<void> {
    if (running) return;
    // Capture the script at launch time. The dropdown stays enabled while the
    // scan runs, so `currentScript` may change mid-scan; the history entry must
    // record the script that actually produced the results, not the one the
    // user happened to select after pressing start.
    const script = currentScript;
    if (!script || !prepared) {
        setStatus("请先选择并解析一个 Pine 脚本", "error");
        return;
    }

    const historyBars = clampHistory(Number(getEls().historyInput.value));
    getEls().historyInput.value = String(historyBars);
    const market = getMarket();
    getEls().marketSelect.value = market;

    running = true;
    stopRequested = false;
    getEls().startBtn.disabled = true;
    getEls().startBtn.hidden = true;
    getEls().stopBtn.hidden = false;
    resetResultsView();

    const inputs = collectInputs();
    const store = createKlineStore();
    const dataSource = createScreenerDataSource({ historyBars, market, store });

    const outcome = await runScan(engine!, dataSource, {
        source: script.source,
        signalPlot: DEFAULT_SIGNAL_PLOT,
        inputs,
        onProgress: scheduleProgress,
        shouldStop: () => stopRequested,
    });

    running = false;
    getEls().startBtn.disabled = false;
    getEls().startBtn.hidden = false;
    getEls().stopBtn.hidden = true;
    if (outcome.phase === "error") {
        const { emptyEl } = getEls();
        emptyEl.hidden = false;
        emptyEl.textContent = "扫描失败：" + (outcome.error ?? "未知错误");
        setStatus("", "");
        return;
    }
    if (outcome.phase === "done") {
        const scan: SavedScan = {
            id: String(Date.now()),
            createdAt: Date.now(),
            scriptId: script.id,
            scriptName: script.name,
            historyBars,
            inputs,
            market,
            total: outcome.total,
            results: outcome.results,
        };
        scanHistory = addScanToHistory(scanHistory, scan);
        persistScanHistory(dashboardStorage, scanHistory);
        selectedHistoryId = scan.id;
        refreshHistoryControls();
        renderResults(outcome.results, scan);
        return;
    }
    renderResults(outcome.results);
}

function clampHistory(n: number): number {
    if (!Number.isFinite(n)) return DEFAULT_HISTORY_BARS;
    return Math.max(HISTORY_MIN, Math.min(HISTORY_MAX, Math.round(n)));
}

const MARKETS: readonly ScanMarket[] = ["spot", "futures", "all"];

/** Read the market selector, falling back to "spot" on unexpected values. */
function getMarket(): ScanMarket {
    const value = getEls().marketSelect.value as ScanMarket;
    return MARKETS.includes(value) ? value : "spot";
}

/** Short label for a market universe, used in the history dropdown. */
function marketLabel(market: ScanMarket): string {
    switch (market) {
        case "futures":
            return "U本位合约";
        case "all":
            return "全部";
        default:
            return "现货";
    }
}

let onOpenSymbol: (ticker: string) => void = () => {};

export function initPineScreener(options: PineScreenerOptions): void {
    onOpenSymbol = options.onOpenSymbol;
    if (initialized) return;
    initialized = true;
    const els = getEls();

    els.scriptSelect.addEventListener("change", () => {
        const scripts = loadPineScripts();
        currentScript = scripts.find((s) => s.id === els.scriptSelect.value) ?? null;
        void prepareCurrentScript();
    });

    els.startBtn.addEventListener("click", () => void startScan());
    els.stopBtn.addEventListener("click", () => {
        stopRequested = true;
        setStatus("正在停止…", "");
    });

    els.historySelect.addEventListener("change", () => {
        selectedHistoryId = els.historySelect.value || null;
        const scan = selectedScan();
        if (scan) renderSavedScan(scan);
        const hasScan = Boolean(scan);
        els.historyRerunBtn.disabled = !hasScan;
        els.historyDeleteBtn.disabled = !hasScan;
    });

    els.historyDeleteBtn.addEventListener("click", () => {
        if (!selectedHistoryId) return;
        scanHistory = removeScanFromHistory(scanHistory, selectedHistoryId);
        persistScanHistory(dashboardStorage, scanHistory);
        selectedHistoryId = null;
        refreshHistoryControls();
        clearResultsView();
    });

    els.historyRerunBtn.addEventListener("click", () => {
        const scan = selectedScan();
        if (scan) void rerunScan(scan);
    });

    refreshPineScreener();
}

/** Re-read persisted scripts + saved scans and refresh the form (IndexedDB hydration). */
export function refreshPineScreener(): void {
    scanHistory = loadScanHistory(dashboardStorage);
    refreshHistoryControls();
    const scripts = loadPineScripts();
    renderScriptSelect(scripts);
    void prepareCurrentScript();
}