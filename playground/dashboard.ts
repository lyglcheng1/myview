// Monitoring dashboard prototype: AICoin-style dark watch screen.
// Custom Chinese chrome around a VelaWorkspace whose DEFAULT view is a single
// 1×1 cell (BTC). Header left = chart controls
// (timeframe/style/indicators/undo-redo/alerts/panels/screenshot),
// header right = search + saved layouts.
//  - top search box (Binance USDT pairs) adds tokens to the active watch group
//  - sidebar watchlist: group tabs (create/rename/delete/drag-sort) + token list
//    (add/remove/drag-sort); clicking a token retargets the ACTIVE chart cell
//  - saved layouts: capture each cell's symbol/timeframe, reapply from a dropdown
//  - custom layout panel: presets + rows × cols, like a table picker
//  - price alerts: Binance REST polling, trigger on crossing a target price
//  - collapsible sidebar
import {
  VelaWorkspace,
  layoutForGrid,
  registerLayout,
  ensureLayout,
  type WorkspaceEventMap,
  type ChartCell,
  type LayoutDefinition,
} from "../src/workspace";
import { layoutForSplit, SPLIT_LAYOUT_ID } from "./splitLayout";
import {
  ALERT_WINDOW_MINUTES,
  alertConditionText,
  intervalForMinutes,
  migrateAlert,
  sortAlerts,
  surgePct,
  type Alert,
  type AlertSortMode,
  type PriceAlert,
  type SurgeAlert,
} from "./alerts";
import { DEFAULT_RING_DURATION_MS, DEFAULT_RING_INTERVAL_MS, RingScheduler } from "./alertRinging";
import { RingSymbolCounter } from "./alertCellHighlight";
import {
  buildSoundList,
  clearCustomSound,
  DEFAULT_SOUND_ID,
  loadCustomSound,
  loadSelectedSoundId,
  playAlertSound,
  playSound,
  resolveSelectedSound,
  saveCustomSound,
  saveSelectedSoundId,
} from "./alertSounds";
import { BinanceProvider } from "../src/data/providers/binance";
import { Vela, type IndicatorHandle, type InputValue } from "../src";
import { HTF_EMA_TYPE } from "./htfEma";
import "./htfEma"; // registers the htf-ema native indicator type
import { PineEngine } from "@luxalgo/vela-pinets";
import { registerDefaultEngine } from "../src/plugin";
import { PineIndicatorMount } from "./pineMount";
import { ConnectionMonitor } from "./connectionStatus";
import {
  initHoldingsView,
  refreshHoldingsCount,
  reloadHoldingsData,
  setAlertQuickSetHandler,
  setHoldingsViewActive,
} from "./holdings";
import { baseSymbolOf } from "./holdingsCore";
import { displaySymbol, fetchLatestPrices, klinesUrl, loadBinanceUsdtSymbols } from "./binanceMarkets";
import { initPineScreener, refreshPineScreener } from "./screener/pineScreener";
import { initTradePlan } from "./tradePlan/tradePlan";
import { dashboardStorage } from "./idbStorage";
import { notifyDesktop } from "./desktopBridge";
import pineScriptSource from "../pine.script?raw"; // the user's Pine v5 strategy source

// Register the Pine scripting engine app-wide before any chart cell is created.
registerDefaultEngine("pine", () => new PineEngine());

// ── Watchlist model & persistence ────────────────────────────────
type WatchGroup = { id: string; name: string; tokens: string[] };
type SavedLayout = {
  id: string;
  name: string;
  /** The grid layout id at save time (e.g. "4", "8", "custom-split") — restored on apply. */
  layoutId: string;
  /** Serializable copy of the grid definition — lets applyLayout re-register
   *  custom/split layouts, which aren't registered at page load. */
  grid?: LayoutDefinition;
  items: { cellId: string; symbol: string; timeframe: string }[];
};

const WATCHLIST_KEY = "vela-dashboard-watchlist";
const LAYOUTS_KEY = "vela-dashboard-layouts";
const FALLBACK_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT",
  "UNIUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT",
];

function loadGroups(): WatchGroup[] {
  try {
    const raw = dashboardStorage.getItem(WATCHLIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WatchGroup[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* corrupted storage → defaults */
  }
  return [
    { id: "main", name: "主流币", tokens: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"] },
    { id: "watch", name: "关注", tokens: ["XRPUSDT", "DOGEUSDT"] },
  ];
}

function saveGroups(): void {
  dashboardStorage.setItem(WATCHLIST_KEY, JSON.stringify(groups));
}

function isValidGrid(g: unknown): g is LayoutDefinition {
  if (!g || typeof g !== "object") return false;
  const def = g as Partial<LayoutDefinition>;
  return (
    typeof def.id === "string" &&
    typeof def.label === "string" &&
    Array.isArray(def.cols) &&
    Array.isArray(def.rows) &&
    Array.isArray(def.cells) &&
    def.cells.every((c) => c && typeof c.id === "string")
  );
}

function loadLayouts(): SavedLayout[] {
  try {
    const raw = dashboardStorage.getItem(LAYOUTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedLayout[];
      if (Array.isArray(parsed)) {
        return parsed
          .filter((l) => l && typeof l.id === "string" && typeof l.name === "string")
          .map((l) => ({
            id: l.id,
            name: l.name,
            layoutId: typeof l.layoutId === "string" ? l.layoutId : "",
            grid: isValidGrid(l.grid) ? l.grid : undefined,
            items: Array.isArray(l.items)
              ? l.items.filter(
                  (i) => i && typeof i.cellId === "string" && typeof i.symbol === "string",
                )
              : [],
          }));
      }
    }
  } catch {
    /* corrupted storage → empty */
  }
  return [];
}

function saveLayouts(): void {
  dashboardStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
}

let groups: WatchGroup[] = loadGroups();
let activeGroupId: string = groups[0]?.id ?? "";
let layouts: SavedLayout[] = loadLayouts();

// Backfill the grid definition for schemes saved before it was captured.
// Built-ins and dynamic grids resolve from the registry; custom/split layouts
// (registered only after their panel is applied in-session) need a re-save to
// carry their definition.
function backfillLayoutGrids(): void {
  let changed = false;
  for (const layout of layouts) {
    if (layout.grid || !layout.layoutId) continue;
    const def = ensureLayout(layout.layoutId);
    if (def) {
      layout.grid = {
        id: def.id,
        label: def.label,
        cols: def.cols,
        rows: def.rows,
        areas: def.areas,
        cells: def.cells,
      };
      changed = true;
    }
  }
  if (changed) saveLayouts();
}
backfillLayoutGrids();

let activeLayoutId: string | null = null;
/** True while applyLayout() is restoring a scheme — its own edits must not
 *  drop the dropdown pin via layout:changed / state:changed. */
let applyingLayout = false;
let allSymbols: string[] = [...FALLBACK_SYMBOLS];

// ── Alerts: price thresholds + surge/dump (Binance REST polling) ─
const ALERTS_KEY = "vela-dashboard-alerts";
const alertSymbolInput = document.getElementById("alert-symbol") as HTMLInputElement;
const alertPriceInput = document.getElementById("alert-price") as HTMLInputElement;
const alertDirectionSelect = document.getElementById("alert-direction") as HTMLSelectElement;
const surgeSymbolInput = document.getElementById("surge-symbol") as HTMLInputElement;
const surgeWindowSelect = document.getElementById("surge-window") as HTMLSelectElement;
const surgeThresholdInput = document.getElementById("surge-threshold") as HTMLInputElement;
const surgeDirectionSelect = document.getElementById("surge-direction") as HTMLSelectElement;
const alertListEl = document.getElementById("alert-list")!;
const alertBadge = document.getElementById("alert-badge")!;
const alertToastsEl = document.getElementById("alert-toasts")!;

// A triggered alert rings its sound repeatedly for the default duration, unless
// the user clicks the alert's toast to mute it. The RingScheduler owns timers;
// `ringingAlerts` keeps the alert objects for the cell highlight / corner badge.
const ringScheduler = new RingScheduler(
  () => playAlertSound(),
  DEFAULT_RING_INTERVAL_MS,
  DEFAULT_RING_DURATION_MS,
  (id) => onRingStopped(id),
);
const ringingAlerts = new Map<string, Alert>();
const cellRingCounter = new RingSymbolCounter();

function loadAlerts(): Alert[] {
  try {
    const raw = dashboardStorage.getItem(ALERTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown[];
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => migrateAlert(x))
          .filter((x): x is Alert => x !== null);
      }
    }
  } catch {
    /* corrupted storage → empty */
  }
  return [];
}

function saveAlerts(): void {
  dashboardStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
}

let alerts: Alert[] = loadAlerts();

function renderAlerts(): void {
  alertListEl.innerHTML = "";
  if (!alerts.length) {
    const tip = document.createElement("div");
    tip.className = "alert-empty";
    tip.textContent = "暂无告警，填写上方表单添加价格或爆拉/暴跌告警";
    alertListEl.appendChild(tip);
  }
  for (const a of alerts) {
    const row = document.createElement("div");
    row.className = "alert-item" + (a.triggered ? " triggered" : "");
    row.innerHTML = `
      <span class="alert-sym">${escapeHtml(a.symbol)}</span>
      <span class="alert-cond">${escapeHtml(alertConditionText(a))}</span>
      <span class="alert-status">${a.triggered ? "已触发" : "监控中"}</span>
      <button class="icon-btn alert-reset" title="重新监控" ${a.triggered ? "" : "hidden"}>↺</button>
      <button class="icon-btn danger alert-remove" title="删除">✕</button>`;
    row.querySelector(".alert-remove")!.addEventListener("click", () => {
      stopAlertRinging(a.id);
      alerts = alerts.filter((x) => x.id !== a.id);
      saveAlerts();
      renderAlerts();
    });
    row.querySelector(".alert-reset")!.addEventListener("click", () => {
      stopAlertRinging(a.id);
      a.triggered = false;
      saveAlerts();
      renderAlerts();
    });
    alertListEl.appendChild(row);
  }
  const activeCount = alerts.filter((a) => !a.triggered).length;
  alertBadge.hidden = activeCount === 0;
  alertBadge.textContent = String(activeCount);
  renderAlertManagement();
}

function activeCellSymbol(): string {
  return activeCellId ? (dashboard.cell(activeCellId)?.symbol ?? "") : "";
}

function refreshAlertSymbolInputs(): void {
  const sym = activeCellSymbol();
  alertSymbolInput.value = sym;
  surgeSymbolInput.value = sym;
}

document.getElementById("alert-add")!.addEventListener("click", () => {
  // Prefer the readonly input: it is the active cell's symbol normally, or the
  // symbol picked from a holdings row action ("设置预警") for a quick alert.
  const symbol = alertSymbolInput.value.trim() || activeCellSymbol();
  const price = Number(alertPriceInput.value);
  if (!symbol || !Number.isFinite(price) || price <= 0) return;
  alerts.unshift({
    id: "a_" + Date.now(),
    symbol,
    kind: alertDirectionSelect.value === "below" ? "price-down" : "price-up",
    price,
    triggered: false,
    createdAt: Date.now(),
  });
  alertPriceInput.value = "";
  saveAlerts();
  renderAlerts();
});

document.getElementById("surge-add")!.addEventListener("click", () => {
  // Same prefill convention as the price alert: holdings row action can set the symbol.
  const symbol = surgeSymbolInput.value.trim() || activeCellSymbol();
  const threshold = Number(surgeThresholdInput.value);
  if (!symbol || !Number.isFinite(threshold) || threshold <= 0) return;
  alerts.unshift({
    id: "s_" + Date.now(),
    symbol,
    kind: surgeDirectionSelect.value as "surge" | "dump",
    windowMinutes: Number(surgeWindowSelect.value),
    thresholdPct: threshold,
    triggered: false,
    createdAt: Date.now(),
  });
  surgeThresholdInput.value = "3";
  saveAlerts();
  renderAlerts();
});

async function pollAlerts(): Promise<void> {
  const active = alerts.filter((a) => !a.triggered);
  if (!active.length) return;
  let changed = false;

  // Price thresholds: latest price vs target (spot + `.P` perpetual pairs).
  const priceAlerts = active.filter(
    (a): a is PriceAlert => a.kind === "price-up" || a.kind === "price-down",
  );
  if (priceAlerts.length) {
    const symbols = [...new Set(priceAlerts.map((a) => a.symbol))];
    try {
      const priceMap = await fetchLatestPrices(symbols);
      for (const a of priceAlerts) {
        const price = priceMap.get(a.symbol);
        if (price === undefined || !Number.isFinite(price)) continue;
        const hit = a.kind === "price-up" ? price >= a.price : price <= a.price;
        if (hit) {
          a.triggered = true;
          changed = true;
          startAlertRinging(
            a,
            `${a.symbol} ${a.kind === "price-up" ? "上穿" : "下穿"} ${a.price}（当前 ${price}）`,
          );
        }
      }
    } catch {
      /* network unavailable → keep monitoring */
    }
  }

  // Surge/dump: percent move over the window from the forming kline's open.
  const surgeAlerts = active.filter(
    (a): a is SurgeAlert => a.kind === "surge" || a.kind === "dump",
  );
  if (surgeAlerts.length) {
    const pctMap = new Map<string, number>();
    const keys = [
      ...new Set(surgeAlerts.map((a) => `${a.symbol}|${intervalForMinutes(a.windowMinutes)}`)),
    ];
    await Promise.all(
      keys.map(async (key) => {
        const sep = key.indexOf("|");
        const symbol = key.slice(0, sep);
        const interval = key.slice(sep + 1);
        try {
          const res = await fetch(klinesUrl(symbol, interval));
          if (!res.ok) return;
          const data = (await res.json()) as unknown[][];
          const last = data[data.length - 1];
          if (!last) return;
          const pct = surgePct(Number(last[1]), Number(last[4]));
          if (Number.isFinite(pct)) pctMap.set(key, pct);
        } catch {
          /* network unavailable → keep monitoring */
        }
      }),
    );
    for (const a of surgeAlerts) {
      const key = `${a.symbol}|${intervalForMinutes(a.windowMinutes)}`;
      const pct = pctMap.get(key);
      if (pct === undefined) continue;
      const hit = a.kind === "surge" ? pct >= a.thresholdPct : pct <= -a.thresholdPct;
      if (hit) {
        a.triggered = true;
        changed = true;
        startAlertRinging(
          a,
          `${a.symbol} ${a.kind === "surge" ? "爆拉" : "暴跌"} ${Math.abs(pct).toFixed(2)}%（${a.windowMinutes}分钟）`,
        );
      }
    }
  }

  if (changed) {
    saveAlerts();
    renderAlerts();
  }
}

const alertTimer = window.setInterval(pollAlerts, 5000);

// `displaySymbol` lives in binanceMarkets.ts (spot + `.P` perpetual labels).

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ── Ringing alerts: repeat the sound, click the toast to mute ────
function showAlertToast(a: Alert, message: string): void {
  const toast = document.createElement("div");
  toast.className = "alert-toast" + (a.kind === "dump" ? " error" : "");
  toast.dataset.alertId = a.id;
  toast.title = "点击静音该条告警";
  toast.innerHTML = `<span>${escapeHtml(message)}</span><span class="alert-toast-mute">🔕 点击静音</span>`;
  toast.addEventListener("click", () => stopAlertRinging(a.id));
  alertToastsEl.appendChild(toast);
}

function hideAlertToast(id: string): void {
  const el = alertToastsEl.querySelector(`[data-alert-id="${id}"]`);
  if (el) el.remove();
}

// Cell visual cue: every cell showing the alert's symbol gets a pulsing border
// ring + a corner badge listing the active alert kinds, until the alert is muted.
function alertIconForKind(kind: Alert["kind"]): string {
  return kind === "price-up" ? "🔺" : kind === "price-down" ? "🔻" : kind === "surge" ? "🚀" : "📉";
}

function ensureCellBadge(cell: ChartCell, symbol: string): void {
  let badge = cell.host.querySelector<HTMLElement>(".alert-cell-badge");
  if (!badge) {
    badge = cell.host.ownerDocument.createElement("div");
    badge.className = "alert-cell-badge";
    cell.host.appendChild(badge);
  }
  const active = [...ringingAlerts.values()].filter((a) => a.symbol === symbol);
  const icons = [...new Set(active.map((a) => alertIconForKind(a.kind)))].join("");
  badge.textContent = icons + (active.length > 1 ? ` ×${active.length}` : "");
}

function highlightCellsForSymbol(symbol: string): void {
  cellRingCounter.add(symbol);
  for (const cell of dashboard.cells().filter((c) => c.symbol === symbol)) {
    cell.host.classList.add("alert-ringing");
    ensureCellBadge(cell, symbol);
  }
}

function unhighlightCellsForSymbol(symbol: string): void {
  if (!cellRingCounter.remove(symbol)) return; // more alerts on this symbol remain
  for (const cell of dashboard.cells().filter((c) => c.symbol === symbol)) {
    cell.host.classList.remove("alert-ringing");
    cell.host.querySelector(".alert-cell-badge")?.remove();
  }
}

function startAlertRinging(a: Alert, message: string): void {
  ringScheduler.start(a.id); // resets any previous state for this id first
  ringingAlerts.set(a.id, a);
  showAlertToast(a, message);
  highlightCellsForSymbol(a.symbol);
  notifyDesktop(`${a.symbol} 告警`, message); // native notification in Electron
}

function onRingStopped(id: string): void {
  hideAlertToast(id);
  const a = ringingAlerts.get(id);
  if (a) {
    ringingAlerts.delete(id);
    unhighlightCellsForSymbol(a.symbol);
  }
}

function stopAlertRinging(id: string): void {
  ringScheduler.stop(id); // fires onStop → onRingStopped (toast + cell cue cleanup)
}

// ── Symbol search (Binance spot + USDT-M perpetual, cached in memory) ──
async function loadSymbols(): Promise<void> {
  const list = await loadBinanceUsdtSymbols();
  if (list.length) allSymbols = list;
}

const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchDropdown = document.getElementById("search-dropdown") as HTMLDivElement;

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toUpperCase();
  if (!q) {
    searchDropdown.hidden = true;
    return;
  }
  const matches = allSymbols.filter((s) => s.includes(q)).slice(0, 30);
  renderDropdown(matches);
});

function renderDropdown(matches: string[]): void {
  searchDropdown.innerHTML = "";
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "未找到匹配的币种";
    searchDropdown.appendChild(empty);
    searchDropdown.hidden = false;
    return;
  }
  for (const symbol of matches) {
    const item = document.createElement("div");
    item.className = "search-item";
    item.addEventListener("click", () => {
      openSymbolInGrid(symbol);
      searchInput.value = "";
      searchDropdown.hidden = true;
    });

    const name = document.createElement("span");
    name.className = "search-item-symbol";
    name.textContent = displaySymbol(symbol);
    item.appendChild(name);

    const star = document.createElement("button");
    star.type = "button";
    star.className = "search-item-star";
    const added = isInActiveGroup(symbol);
    if (added) {
      star.classList.add("added");
      star.textContent = "★";
      star.title = "已在自选中";
    } else {
      star.textContent = "☆";
      star.title = "加入自选";
    }
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      addTokenToActiveGroup(symbol);
      star.classList.add("added");
      star.textContent = "★";
      star.title = "已在自选中";
    });
    item.appendChild(star);

    searchDropdown.appendChild(item);
  }
  searchDropdown.hidden = false;
}

function isInActiveGroup(symbol: string): boolean {
  if (!activeGroupId) return false;
  const group = groups.find((g) => g.id === activeGroupId);
  return group ? group.tokens.includes(symbol) : false;
}

document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#search-wrap")) {
    searchDropdown.hidden = true;
  }
});

function addTokenToActiveGroup(symbol: string): void {
  if (!activeGroupId) {
    const g: WatchGroup = { id: "g_" + Date.now(), name: "默认分组", tokens: [] };
    groups.push(g);
    activeGroupId = g.id;
  }
  const group = groups.find((g) => g.id === activeGroupId)!;
  if (!group.tokens.includes(symbol)) {
    group.tokens.push(symbol);
    saveGroups();
    renderGroups();
    renderTokens();
  }
}

// ── Watchlist rendering ──────────────────────────────────────────
function renderGroups(): void {
  const list = document.getElementById("group-list")!;
  list.innerHTML = "";
  if (!groups.length) {
    const tip = document.createElement("div");
    tip.className = "empty-tip";
    tip.textContent = "暂无分组，点「＋」新建";
    list.appendChild(tip);
    return;
  }
  for (const group of groups) {
    list.appendChild(createGroupItem(group));
  }
}

function renderTokens(): void {
  const list = document.getElementById("token-list")!;
  const count = document.getElementById("token-count")!;
  list.innerHTML = "";
  const group = groups.find((g) => g.id === activeGroupId);
  if (!group) {
    count.textContent = "";
    const tip = document.createElement("li");
    tip.className = "empty-tip";
    tip.textContent = "请先选择或新建分组";
    list.appendChild(tip);
    return;
  }
  count.textContent = `${group.tokens.length} 个币种`;
  if (!group.tokens.length) {
    const tip = document.createElement("li");
    tip.className = "empty-tip";
    tip.textContent = "在顶部搜索框添加币种";
    list.appendChild(tip);
    return;
  }
  for (const token of group.tokens) {
    list.appendChild(createTokenEl(token));
  }
}

function createGroupItem(group: WatchGroup): HTMLElement {
  const div = document.createElement("div");
  div.className = "group-item" + (group.id === activeGroupId ? " active" : "");
  div.setAttribute("data-group-id", group.id);
  div.draggable = true;
  div.innerHTML = `
    <span class="grip" title="拖动排序">⠿</span>
    <span class="group-name">${escapeHtml(group.name)}</span>
    <span class="group-count">${group.tokens.length}</span>
    <button class="icon-btn danger group-delete" title="删除分组">✕</button>`;

  // Click a group → show its tokens below and return to the K-line grid.
  div.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".group-delete")) return;
    activeGroupId = group.id;
    renderGroups();
    renderTokens();
    showKlineView();
  });

  // Delete group.
  const deleteBtn = div.querySelector(".group-delete") as HTMLButtonElement;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (window.confirm(`删除分组「${group.name}」？`)) {
      groups = groups.filter((g) => g.id !== group.id);
      if (activeGroupId === group.id) activeGroupId = groups[0]?.id ?? "";
      saveGroups();
      renderGroups();
      renderTokens();
    }
  });

  // Double-click the name to rename.
  const nameEl = div.querySelector(".group-name") as HTMLElement;
  nameEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startRename(group, div);
  });

  bindGroupDnD(div, group.id);
  return div;
}

function createTokenEl(token: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "token";
  li.setAttribute("data-token", token);
  li.draggable = true;
  li.innerHTML = `
    <span class="grip" title="拖动排序">⠿</span>
    <span class="token-symbol">${escapeHtml(displaySymbol(token))}</span>
    <button class="token-remove" title="移除">×</button>`;

  const removeBtn = li.querySelector(".token-remove") as HTMLButtonElement;
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const group = groups.find((g) => g.id === activeGroupId);
    if (group) {
      group.tokens = group.tokens.filter((t) => t !== token);
      saveGroups();
      renderGroups();
      renderTokens();
    }
  });

  // Click a token → retarget the ACTIVE chart cell to that symbol and return
  // to the K-line grid.
  li.addEventListener("click", () => {
    if (activeCellId && !li.classList.contains("dragging")) {
      dashboard.cell(activeCellId)?.setSymbol(token);
      markLayoutDirty(); // the applied scheme no longer matches this cell
    }
    showKlineView();
  });

  bindTokenDnD(li);
  return li;
}

// ── Drag sorting ──────────────────────────────────────────────────
function bindGroupDnD(groupEl: HTMLElement, groupId: string): void {
  groupEl.addEventListener("dragstart", () => {
    groupEl.classList.add("dragging");
  });
  groupEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragged = document.querySelector(".group-item.dragging") as HTMLElement | null;
    if (!dragged || dragged === groupEl) return;
    const rect = groupEl.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const list = groupEl.parentElement!;
    if (after) {
      if (groupEl.nextElementSibling !== dragged) list.insertBefore(dragged, groupEl.nextElementSibling);
    } else if (groupEl !== dragged) {
      list.insertBefore(dragged, groupEl);
    }
  });
  groupEl.addEventListener("drop", (e) => {
    e.preventDefault();
    const list = document.getElementById("group-list")!;
    const order = Array.from(list.querySelectorAll(".group-item")).map((el) => el.getAttribute("data-group-id")!);
    groups.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    saveGroups();
    renderGroups();
  });
  groupEl.addEventListener("dragend", () => {
    document.querySelectorAll(".group-item.dragging").forEach((el) => el.classList.remove("dragging"));
  });
}

function bindTokenDnD(li: HTMLLIElement): void {
  li.addEventListener("dragstart", () => {
    li.classList.add("dragging");
  });
  li.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragged = document.querySelector(".token.dragging") as HTMLElement | null;
    if (!dragged || dragged === li) return;
    const rect = li.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const ul = li.parentElement!;
    if (after) {
      if (li.nextElementSibling !== dragged) ul.insertBefore(dragged, li.nextElementSibling);
    } else if (li !== dragged) {
      ul.insertBefore(dragged, li);
    }
  });
  li.addEventListener("drop", (e) => {
    e.preventDefault();
    const ul = li.parentElement as HTMLUListElement;
    const group = groups.find((g) => g.id === activeGroupId);
    if (group) {
      group.tokens = Array.from(ul.querySelectorAll(".token")).map((el) => el.getAttribute("data-token")!);
      saveGroups();
      renderTokens();
    }
  });
  li.addEventListener("dragend", () => {
    document.querySelectorAll(".token.dragging").forEach((el) => el.classList.remove("dragging"));
  });
}

// ── Group create / rename ────────────────────────────────────────
function startNewGroup(): void {
  const list = document.getElementById("group-list")!;
  const wrap = document.createElement("div");
  wrap.className = "group-new";
  const input = document.createElement("input");
  input.placeholder = "输入分组名称，回车确认";
  wrap.appendChild(input);
  list.prepend(wrap);
  input.focus();

  let committed = false;
  const commit = () => {
    if (committed) return;
    const name = input.value.trim();
    if (name) {
      const group: WatchGroup = { id: "g_" + Date.now(), name, tokens: [] };
      groups.push(group);
      activeGroupId = group.id;
      saveGroups();
    }
    committed = true;
    renderGroups();
    renderTokens();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      committed = true;
      renderGroups();
    }
  });
  input.addEventListener("blur", commit);
}

function startRename(group: WatchGroup, itemEl: HTMLElement): void {
  const nameEl = itemEl.querySelector(".group-name") as HTMLElement;
  const input = document.createElement("input");
  input.className = "group-name-input";
  input.value = group.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    const name = input.value.trim();
    if (name) {
      group.name = name;
      saveGroups();
    }
    committed = true;
    renderGroups();
    renderTokens();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      committed = true;
      renderGroups();
    }
  });
  input.addEventListener("blur", commit);
}

document.getElementById("add-group-btn")!.addEventListener("click", startNewGroup);

// ── Sidebar collapse ────────────────────────────────────────────────
const appEl = document.getElementById("app")!;
const mainEl = document.getElementById("main")!;
document.getElementById("collapse-btn")!.addEventListener("click", () => {
  mainEl.classList.add("sidebar-collapsed");
  appEl.classList.add("sidebar-collapsed");
});
document.getElementById("sidebar-expand")!.addEventListener("click", () => {
  mainEl.classList.remove("sidebar-collapsed");
  appEl.classList.remove("sidebar-collapsed");
});

// ── 功能模块：K 线网格 ↔ 持仓视图切换 ─────────────────────────
const holdingsViewEl = document.getElementById("holdings-view")!;
const holdingsEntryEl = document.getElementById("holdings-entry")!;
const watchlistTabEl = document.getElementById("watchlist-tab")!;
const holdingsTabEl = document.getElementById("holdings-tab")!;
const watchlistPanelEl = document.getElementById("watchlist-panel")!;
const holdingsPanelEl = document.getElementById("holdings-panel")!;

// 侧栏顶部 tab：自选 ↔ 功能模块，与右侧视图联动。
function setSidebarTab(tab: "watchlist" | "holdings"): void {
  const watchlist = tab === "watchlist";
  watchlistTabEl.classList.toggle("active", watchlist);
  holdingsTabEl.classList.toggle("active", !watchlist);
  watchlistPanelEl.hidden = !watchlist;
  holdingsPanelEl.hidden = watchlist;
}

function hideFeaturePanel(): void {
  const featurePanelEl = document.getElementById("feature-panel");
  if (featurePanelEl) featurePanelEl.hidden = true;
  const dashboardEl = document.getElementById("dashboard");
  const wasHidden = dashboardEl.hidden;
  dashboardEl.hidden = false;
  document.querySelectorAll<HTMLButtonElement>(".feature-entry").forEach((btn) => {
    btn.classList.remove("active");
  });
  if (wasHidden) dashboard.resize();
}

function showHoldingsView(): void {
  closeScreenerPreview();
  holdingsViewEl.hidden = false;
  holdingsEntryEl.classList.add("active");
  setSidebarTab("holdings");
  setHoldingsViewActive(true);
  hideFeaturePanel();
}

function showKlineView(): void {
  closeScreenerPreview();
  holdingsViewEl.hidden = true;
  holdingsEntryEl.classList.remove("active");
  setSidebarTab("watchlist");
  setHoldingsViewActive(false);
  hideFeaturePanel();
}

// 右侧功能面板：点击「功能模块」里的功能入口，用功能面板替换 K 线网格。
function showFeatureView(featureId: string): void {
  if (featureId !== "pine-screener") closeScreenerPreview();
  holdingsViewEl.hidden = true;
  holdingsEntryEl.classList.remove("active");
  setHoldingsViewActive(false);
  document.getElementById("dashboard")!.hidden = true;
  const featurePanelEl = document.getElementById("feature-panel");
  featurePanelEl.hidden = false;
  document.querySelectorAll<HTMLButtonElement>(".feature-entry").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.feature === featureId);
  });
  const pineScreenerApp = document.getElementById("pine-screener-app");
  if (pineScreenerApp) pineScreenerApp.hidden = featureId !== "pine-screener";
  // Re-read persisted scripts each time the feature opens, so a script just
  // saved in the Pine dock appears in the dropdown without a page refresh.
  if (featureId === "pine-screener") refreshPineScreener();
  const tradePlanApp = document.getElementById("trade-plan-app");
  if (tradePlanApp) tradePlanApp.hidden = featureId !== "trade-plan";
}

// 点功能模块 tab / 侧栏入口打开持仓视图；点自选 tab / 普通分组 / 自选币种 /
// 持仓视图空白回到 K 线网格。
watchlistTabEl.addEventListener("click", () => {
  setSidebarTab("watchlist");
  showKlineView();
});
holdingsTabEl.addEventListener("click", () => {
  setSidebarTab("holdings");
  showHoldingsView();
});
holdingsEntryEl.addEventListener("click", showHoldingsView);
document.getElementById("feature-pine-screener")?.addEventListener("click", () => {
  showFeatureView("pine-screener");
});
document.getElementById("feature-trade-plan")?.addEventListener("click", () => {
  showFeatureView("trade-plan");
});
holdingsViewEl.addEventListener("click", (e) => {
  if (e.target === holdingsViewEl) showKlineView();
});

// ── Per-cell timeframe switcher (each grid cell carries its own) ─
const CELL_TIMEFRAMES = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "10", label: "10m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "480", label: "8h" },
  { value: "720", label: "12h" },
  { value: "D", label: "1d" },
  { value: "W", label: "1w" },
  { value: "M", label: "1M" },
];
const cellTimeframeSelects = new Map<string, HTMLSelectElement>();

function buildCellTimeframeSelect(cell: ChartCell): HTMLSelectElement {
  const existing = cell.host.querySelector<HTMLSelectElement>(".cell-timeframe-select");
  if (existing) return existing;
  const select = document.createElement("select");
  select.className = "cell-timeframe-select";
  select.title = "切换周期";
  for (const tf of CELL_TIMEFRAMES) {
    const opt = document.createElement("option");
    opt.value = tf.value;
    opt.textContent = tf.label;
    select.appendChild(opt);
  }
  select.value = cell.timeframe;
  select.addEventListener("change", () => {
    if (select.value !== cell.timeframe) {
      cell.setTimeframe(select.value);
      markLayoutDirty(); // the applied scheme no longer matches this cell
    }
  });
  // Keep the dropdown in sync when the timeframe changes elsewhere (saved layouts…).
  cell.chart.on("market:changed", ({ timeframe }) => {
    if (select.value !== timeframe) select.value = timeframe;
  });
  cell.host.appendChild(select);
  return select;
}

// ── Theme (day/night mode) ─────────────────────────────────────
type AppTheme = "dark" | "light";
const THEME_KEY = "vela-dashboard-theme";
const themeToggleBtn = document.getElementById("theme-toggle") as HTMLButtonElement;

function loadTheme(): AppTheme {
  try {
    const saved = dashboardStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* corrupted storage → dark */
  }
  return "dark";
}

function applyTheme(theme: AppTheme): void {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  themeToggleBtn.title = theme === "dark" ? "切换到白天模式" : "切换到黑夜模式";
  themeToggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  try {
    dashboardStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable → theme stays for this session */
  }
}

let currentTheme: AppTheme = loadTheme();
applyTheme(currentTheme);

// ── K-line grid ──────────────────────────────────────────────────
const dashboard = new VelaWorkspace("#dashboard", {
  layout: "1", // the default view is a single 1×1 cell (BTC)
  symbol: "BTCUSDT",
  timeframe: "15",
  cells: {
    btc: { symbol: "BTCUSDT", timeframe: "15" },
    eth: { symbol: "ETHUSDT", timeframe: "15" },
    sol: { symbol: "SOLUSDT", timeframe: "15" },
    bnb: { symbol: "BNBUSDT", timeframe: "15" },
  },
  providers: { binance: () => new BinanceProvider() },
  live: true,
  theme: currentTheme,
  // Green up / red down (international style)
  upColor: "#089981",
  downColor: "#f23645",
  // Hide the built-in English topbar; the page renders its own Chinese chrome.
  topbar: { left: [], right: [] },
  // Keep the built-in bottom range bar (1D/1W/1M/3M/ALL + time zone).
  bottombar: true,
  statusline: true,
  watermark: true,
  autofocus: true,
  persist: false,
});

// Day/night toggle: swap the page CSS variables and re-skin every chart.
themeToggleBtn.addEventListener("click", () => {
  const next: AppTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(next);
  dashboard.setTheme(next);
  screenerPreviewChart?.setTheme(next);
});

// ── Chart style switcher (active cell) ──────────────────────────
const STYLES = [
  { value: "candles", label: "蜡烛图" },
  { value: "bars", label: "柱状图" },
  { value: "line", label: "折线图" },
  { value: "area", label: "面积图" },
  { value: "baseline", label: "基线图" },
  { value: "heikinashi", label: "平均K线" },
];
const styleSelect = document.getElementById("style-select") as HTMLSelectElement;
for (const s of STYLES) {
  const opt = document.createElement("option");
  opt.value = s.value;
  opt.textContent = s.label;
  styleSelect.appendChild(opt);
}
styleSelect.addEventListener("change", () => {
  if (activeCellId) dashboard.cell(activeCellId)?.setPriceStyle(styleSelect.value);
});

// ── Indicator picker (adds to the active cell) ─────────────────
const INDICATORS = [
  { value: "sma", label: "SMA 简单均线" },
  { value: "ema", label: "EMA 指数均线" },
  { value: "moving-average", label: "MA 双均线" },
  { value: "bollinger-bands", label: "BOLL 布林带" },
  { value: "keltner-channels", label: "肯特纳通道" },
  { value: "vwap", label: "VWAP 加权均价" },
  { value: "macd", label: "MACD" },
  { value: "rsi", label: "RSI 相对强弱" },
  { value: "stochastic", label: "KDJ 随机指标" },
  { value: "commodity-channel-index", label: "CCI 通道指标" },
  { value: "awesome-oscillator", label: "AO 动量震荡" },
  { value: "supertrend", label: "超级趋势" },
  { value: "parabolic-sar", label: "抛物线 SAR" },
  { value: "average-directional-index", label: "ADX 趋势强度" },
  { value: "volume", label: "VOL 成交量" },
  { value: "on-balance-volume", label: "OBV 能量潮" },
  { value: "money-flow-index", label: "MFI 资金流量" },
  { value: "average-true-range", label: "ATR 真实波幅" },
  { value: "zigzag", label: "ZIGZAG 之字转折" },
];
const indicatorSelect = document.getElementById("indicator-select") as HTMLSelectElement;
const placeholderOpt = document.createElement("option");
placeholderOpt.value = "";
placeholderOpt.textContent = "＋ 添加指标";
indicatorSelect.appendChild(placeholderOpt);
for (const ind of INDICATORS) {
  const opt = document.createElement("option");
  opt.value = ind.value;
  opt.textContent = ind.label;
  indicatorSelect.appendChild(opt);
}
indicatorSelect.addEventListener("change", () => {
  const type = indicatorSelect.value;
  if (!type) return;
  dashboard.cell(activeCellId)?.addNative(type);
  indicatorSelect.value = "";
});

// ── Undo / redo (active cell's history) ─────────────────────────
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const redoBtn = document.getElementById("redo-btn") as HTMLButtonElement;
let historyUnsub: (() => void) | null = null;

function updateHistoryButtons(cell: ChartCell | undefined): void {
  undoBtn.disabled = !(cell?.history.canUndo ?? false);
  redoBtn.disabled = !(cell?.history.canRedo ?? false);
}

function bindHistory(cell: ChartCell | undefined): void {
  historyUnsub?.();
  historyUnsub = undefined;
  if (!cell) return;
  const push = (): void => updateHistoryButtons(cell);
  historyUnsub = cell.history.onChange(push);
  push();
}

undoBtn.addEventListener("click", () => dashboard.cell(activeCellId)?.history.undo());
redoBtn.addEventListener("click", () => dashboard.cell(activeCellId)?.history.redo());

// ── Alerts panel toggle ────────────────────────────────────────────
const alertsBtn = document.getElementById("alerts-btn")!;
const alertsPanel = document.getElementById("alerts-panel")!;
alertsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  refreshAlertSymbolInputs();
  alertsPanel.hidden = !alertsPanel.hidden;
});

// Holdings rows can start a price alert for that position quickly: opening the
// shared alerts popover pre-fills the symbol and focuses the target price.
setAlertQuickSetHandler((symbol) => {
  alertSymbolInput.value = symbol;
  surgeSymbolInput.value = symbol;
  alertPriceInput.value = "";
  alertsPanel.hidden = false;
  alertPriceInput.focus();
});

// ── Side panels (object tree / data window) ─────────────────────
const panelsBtn = document.getElementById("panels-btn")!;
const panelsPanel = document.getElementById("panels-panel")!;
panelsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  panelsPanel.hidden = !panelsPanel.hidden;
});
document.querySelectorAll<HTMLButtonElement>(".panel-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    dashboard.context().togglePanel(btn.dataset.panelId!);
    panelsPanel.hidden = true;
  });
});

// ── Screenshot ───────────────────────────────────────────────────
document.getElementById("screenshot-btn")!.addEventListener("click", () => {
  dashboard.downloadScreenshot();
});

// No cell is selected on startup: the first grid tile must not be pre-highlighted.
// The active cell is chosen explicitly by clicking a tile (or a watchlist token).
let activeCellId: string | null = null;
dashboard.setActiveCell(null);
refreshAlertSymbolInputs();
dashboard.on("cell:active", (payload: WorkspaceEventMap["cell:active"]) => {
  activeCellId = payload.id;
  const cell = dashboard.cell(payload.id);
  if (cell) {
    styleSelect.value = cell.priceStyle;
    bindHistory(cell);
    refreshAlertSymbolInputs();
  }
});

// Clicking empty workspace background deselects the active cell.
const dashboardEl = document.getElementById("dashboard")!;
dashboardEl.addEventListener("click", (e) => {
  if (!(e.target as Element).closest(".vela-cell")) {
    dashboard.setActiveCell(null);
    activeCellId = null;
    refreshAlertSymbolInputs();
  }
});

/** Open a ticker in the K-line grid (watchlist, search, screener results…). */
function openSymbolInGrid(ticker: string): void {
  const targetId = activeCellId ?? dashboard.cells()[0]?.id ?? null;
  if (targetId) {
    dashboard.setActiveCell(targetId);
    dashboard.cell(targetId)?.setSymbol(ticker);
    markLayoutDirty(); // the applied scheme no longer matches this cell
  }
  closeScreenerPreview();
  showKlineView();
}

// ── Pine 选币命中币浮动预览 ─────────────────────────────────
// Clicking a screener result used to switch the whole grid away from the
// screener, forcing 功能模块 → Pine 选币 → history to see the next match. A
// floating chart window instead keeps the screener panel usable, letting the
// user flip through matches by clicking rows. One chart instance is reused for
// the session and destroyed when the window is closed.
let screenerPreviewChart: Vela | null = null;
let screenerPreviewTicker = "";
let screenerPreviewTimeframe = "15";

function showScreenerPreview(ticker: string): void {
  const dialog = document.getElementById("screener-preview");
  const titleEl = document.getElementById("screener-preview-title");
  const chartHost = document.getElementById("screener-preview-chart");
  if (!dialog || !titleEl || !chartHost) return;
  titleEl.textContent = ticker;
  dialog.hidden = false;
  if (!screenerPreviewChart) {
    screenerPreviewChart = new Vela(chartHost, {
      timeframe: screenerPreviewTimeframe,
      live: true,
      theme: currentTheme,
      upColor: "#089981",
      downColor: "#f23645",
      topbar: { left: [], right: [] },
    });
    screenerPreviewChart.data.registerProvider("binance", new BinanceProvider());
  }
  if (screenerPreviewTicker !== ticker) {
    screenerPreviewTicker = ticker;
    void screenerPreviewChart.setMarket({ symbol: ticker, timeframe: screenerPreviewTimeframe });
  }
}

function closeScreenerPreview(): void {
  const dialog = document.getElementById("screener-preview");
  if (dialog) dialog.hidden = true;
  if (screenerPreviewChart) {
    screenerPreviewChart.destroy();
    screenerPreviewChart = null;
    screenerPreviewTicker = "";
  }
}

function initScreenerPreviewWindow(): void {
  const tfSelect = document.getElementById("screener-preview-timeframe") as HTMLSelectElement | null;
  const gridBtn = document.getElementById("screener-preview-grid");
  const closeBtn = document.getElementById("screener-preview-close");
  if (tfSelect) {
    for (const tf of CELL_TIMEFRAMES) {
      const opt = document.createElement("option");
      opt.value = tf.value;
      opt.textContent = tf.label;
      tfSelect.appendChild(opt);
    }
    tfSelect.value = screenerPreviewTimeframe;
    tfSelect.addEventListener("change", () => {
      screenerPreviewTimeframe = tfSelect.value;
      if (screenerPreviewChart && screenerPreviewTicker) {
        void screenerPreviewChart.setMarket({ symbol: screenerPreviewTicker, timeframe: screenerPreviewTimeframe });
      }
    });
  }
  gridBtn?.addEventListener("click", () => {
    if (screenerPreviewTicker) openSymbolInGrid(screenerPreviewTicker);
  });
  closeBtn?.addEventListener("click", closeScreenerPreview);
}

// Debug handle for the browser console.
(window as unknown as { __dashboard: VelaWorkspace }).__dashboard = dashboard;

// ── Layouts: save / apply / picker ──────────────────────────────
function captureCurrentLayout(): Pick<SavedLayout, "layoutId" | "grid" | "items"> {
  const def = dashboard.layout;
  return {
    layoutId: def.id,
    grid: {
      id: def.id,
      label: def.label,
      cols: def.cols,
      rows: def.rows,
      areas: def.areas,
      cells: def.cells,
    },
    items: dashboard.cells().map((c) => ({
      cellId: c.id,
      symbol: c.symbol,
      timeframe: c.timeframe,
    })),
  };
}

/** Value of the "默认布局（1格）" option. Kept distinct from "" (the neutral
 *  placeholder) so selecting the default after switching away always fires "change". */
const DEFAULT_OPTION_VALUE = "__default__";

function renderLayoutPicker(activeId: string | null = null): void {
  const select = document.getElementById("layout-select") as HTMLSelectElement;
  select.innerHTML = '<option value="">— 选择布局 —</option>';
  const defOpt = document.createElement("option");
  defOpt.value = DEFAULT_OPTION_VALUE;
  defOpt.textContent = "默认布局（1格）";
  select.appendChild(defOpt);
  for (const layout of layouts) {
    const opt = document.createElement("option");
    opt.value = layout.id;
    opt.textContent = layout.name;
    select.appendChild(opt);
  }
  // Pin the select to the applied scheme so the user sees which one is live.
  // The pin drops back to neutral "— 选择布局 —" as soon as the grid diverges
  // from that scheme (markLayoutDirty), so re-selecting it still fires "change".
  if (activeId === DEFAULT_OPTION_VALUE) {
    select.value = DEFAULT_OPTION_VALUE;
  } else if (activeId && layouts.some((l) => l.id === activeId)) {
    select.value = activeId;
  }
  syncDeleteLayoutBtn();
}

/** Rename/delete only make sense when a saved layout (not the default) is selected. */
function syncDeleteLayoutBtn(): void {
  const savedSelected = !!layoutSelect.value && layoutSelect.value !== DEFAULT_OPTION_VALUE;
  renameLayoutBtn.hidden = !savedSelected;
  deleteLayoutBtn.hidden = !savedSelected;
}

/** The grid no longer matches the active scheme (user edited cells/grid) — drop
 *  the pin so picking the same scheme again fires "change" and reapplies it. */
function markLayoutDirty(): void {
  if (activeLayoutId === null) return;
  activeLayoutId = null;
  const select = document.getElementById("layout-select") as HTMLSelectElement;
  if (select.value) select.value = "";
}

/** True when two grid definitions describe the same arrangement (id, tracks,
 *  areas, slot ids) — ignores splitter-dragged track sizes, which live elsewhere. */
function sameLayoutDef(a: LayoutDefinition, b: LayoutDefinition): boolean {
  if (a.id !== b.id) return false;
  if (a.cols.join(",") !== b.cols.join(",")) return false;
  if (a.rows.join(",") !== b.rows.join(",")) return false;
  if ((a.areas?.join("|") ?? "") !== (b.areas?.join("|") ?? "")) return false;
  if (a.cells.length !== b.cells.length) return false;
  return a.cells.every(
    (c, i) => c.id === b.cells[i]?.id && (c.area ?? "") === (b.cells[i]?.area ?? ""),
  );
}

/** True when the current grid still represents the saved scheme (same grid
 *  structure, same per-cell symbol/timeframe). */
function currentMatches(layout: SavedLayout): boolean {
  const cells = dashboard.cells();
  if (cells.length !== layout.items.length) return false;
  const savedLayoutId = layout.grid?.id ?? layout.layoutId;
  if (savedLayoutId && savedLayoutId !== dashboard.layout.id) return false;
  for (const [i, item] of layout.items.entries()) {
    const cell = dashboard.cell(item.cellId) ?? cells[i];
    if (!cell || cell.symbol !== item.symbol || cell.timeframe !== item.timeframe) return false;
  }
  return true;
}

function applyLayout(id: string): void {
  const layout = layouts.find((l) => l.id === id);
  if (!layout) return;
  // Restore the grid structure first so a saved multi-timeframe / split setup
  // reapplies its cell count and arrangement, not just the per-cell content.
  applyingLayout = true;
  try {
    const grid = layout.grid ?? (layout.layoutId ? ensureLayout(layout.layoutId) : undefined);
    if (!grid) {
      dashboard.toast("该方案为旧版，仅恢复每格内容；重新保存一次可包含网格结构", "info", 4000);
    } else {
      // Re-register the saved definition: built-ins/dynamic grids resolve from the
      // registry anyway, while custom/split layouts only exist in the registry after
      // their panel was applied in THIS page session — and a later split edit may
      // have REPLACED the same id with a different arrangement.
      registerLayout(grid);
      if (!sameLayoutDef(grid, dashboard.layout)) {
        dashboard.setLayout(grid.id);
      }
    }
    const cells = dashboard.cells();
    for (const [i, item] of layout.items.entries()) {
      // Match by saved cell id first; if the grid was re-laid out and the id is
      // gone (e.g. split layouts renamed slots), fall back to the same position.
      const cell = dashboard.cell(item.cellId) ?? cells[i];
      if (cell) {
        cell.setSymbol(item.symbol);
        cell.setTimeframe(item.timeframe);
      }
    }
  } finally {
    applyingLayout = false;
  }
  activeLayoutId = layout.id;
  saveLayouts();
  renderLayoutPicker(layout.id);
}

// The fixed default view: one 1×1 cell showing BTCUSDT on the 15m timeframe.
// Selecting "默认布局" in the dropdown returns the grid to this state.
const DEFAULT_LAYOUT_ID = "1";
const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_TIMEFRAME = "15";

/** True while the grid is still the pristine default (1 cell, BTCUSDT/15m). */
function currentMatchesDefault(): boolean {
  const cells = dashboard.cells();
  return (
    cells.length === 1 &&
    cells[0]?.symbol === DEFAULT_SYMBOL &&
    cells[0]?.timeframe === DEFAULT_TIMEFRAME
  );
}

function applyDefaultLayout(): void {
  applyingLayout = true;
  try {
    const def = ensureLayout(DEFAULT_LAYOUT_ID) ?? layoutForGrid(1, 1);
    registerLayout(def);
    if (!sameLayoutDef(def, dashboard.layout)) {
      dashboard.setLayout(DEFAULT_LAYOUT_ID);
    }
    const cell = dashboard.cells()[0];
    if (cell) {
      cell.setSymbol(DEFAULT_SYMBOL);
      cell.setTimeframe(DEFAULT_TIMEFRAME);
    }
  } finally {
    applyingLayout = false;
  }
  activeLayoutId = DEFAULT_OPTION_VALUE;
  saveLayouts();
  renderLayoutPicker(DEFAULT_OPTION_VALUE);
}

function saveCurrentLayout(name: string): void {
  const captured = captureCurrentLayout();
  const layout: SavedLayout = {
    id: "l_" + Date.now(),
    name,
    layoutId: captured.layoutId,
    grid: captured.grid,
    items: captured.items,
  };
  layouts.push(layout);
  activeLayoutId = layout.id;
  saveLayouts();
  renderLayoutPicker(layout.id);
}

const layoutSelect = document.getElementById("layout-select") as HTMLSelectElement;
const saveLayoutBtn = document.getElementById("save-layout-btn") as HTMLButtonElement;
const layoutNameInput = document.getElementById("layout-name-input") as HTMLInputElement;
const renameLayoutBtn = document.getElementById("rename-layout-btn") as HTMLButtonElement;
const renameLayoutInput = document.getElementById("rename-layout-input") as HTMLInputElement;
const deleteLayoutBtn = document.getElementById("delete-layout-btn") as HTMLButtonElement;

layoutSelect.addEventListener("change", () => {
  const value = layoutSelect.value;
  if (value === DEFAULT_OPTION_VALUE) {
    applyDefaultLayout();
  } else if (value) {
    applyLayout(value);
  } else {
    // Neutral placeholder selected — no scheme to apply, just drop any stale pin.
    activeLayoutId = null;
  }
  syncDeleteLayoutBtn();
});

// Delete the layout currently selected in the dropdown.
deleteLayoutBtn.addEventListener("click", () => {
  const id = layoutSelect.value;
  const name = layouts.find((l) => l.id === id)?.name ?? "";
  if (!id || !name) return;
  if (!confirm(`确定删除布局方案「${name}」吗？`)) return;
  layouts = layouts.filter((l) => l.id !== id);
  if (activeLayoutId === id) activeLayoutId = null;
  saveLayouts();
  renderLayoutPicker();
  dashboard.toast(`已删除布局「${name}」`, "info", 3000);
});

// Drop the pin whenever the grid moves away from the applied scheme — either
// the grid structure changes (preset/split), or cell content changes (symbol
// via watchlist/topbar search, timeframe, …). state:changed is debounced
// ~500ms by the workspace, which also swallows applyLayout's own edits because
// the restored grid then matches the active scheme (currentMatches).
dashboard.on("layout:changed", () => {
  if (!applyingLayout) markLayoutDirty();
});
dashboard.on("state:changed", () => {
  if (activeLayoutId === null) return;
  if (activeLayoutId === DEFAULT_OPTION_VALUE) {
    if (!currentMatchesDefault()) markLayoutDirty();
    return;
  }
  const layout = layouts.find((l) => l.id === activeLayoutId);
  if (layout && !currentMatches(layout)) markLayoutDirty();
});

saveLayoutBtn.addEventListener("click", () => {
  layoutCommitted = false;
  saveLayoutBtn.hidden = true;
  layoutNameInput.hidden = false;
  layoutNameInput.value = "";
  layoutNameInput.focus();
});

let layoutCommitted = false;
const commitLayout = () => {
  if (layoutCommitted) return;
  const name = layoutNameInput.value.trim();
  if (name) saveCurrentLayout(name);
  layoutCommitted = true;
  layoutNameInput.hidden = true;
  saveLayoutBtn.hidden = false;
  layoutNameInput.value = "";
};
layoutNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") commitLayout();
  if (e.key === "Escape") {
    layoutCommitted = true;
    layoutNameInput.hidden = true;
    saveLayoutBtn.hidden = false;
    layoutNameInput.value = "";
  }
});
layoutNameInput.addEventListener("blur", commitLayout);

// Rename the saved layout currently selected in the dropdown.
renameLayoutBtn.addEventListener("click", () => {
  const layout = layouts.find((l) => l.id === layoutSelect.value);
  if (!layout) return;
  renameCommitted = false;
  renameLayoutBtn.hidden = true;
  renameLayoutInput.hidden = false;
  renameLayoutInput.value = layout.name;
  renameLayoutInput.focus();
  renameLayoutInput.select();
});

let renameCommitted = false;
const commitRename = () => {
  if (renameCommitted) return;
  const layout = layouts.find((l) => l.id === layoutSelect.value);
  const name = renameLayoutInput.value.trim();
  if (layout && name && name !== layout.name) {
    layout.name = name;
    saveLayouts();
    renderLayoutPicker(layout.id);
    dashboard.toast(`已重命名为「${name}」`, "info", 3000);
  }
  renameCommitted = true;
  renameLayoutInput.hidden = true;
  renameLayoutBtn.hidden = false;
  renameLayoutInput.value = "";
};
renameLayoutInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") commitRename();
  if (e.key === "Escape") {
    renameCommitted = true;
    renameLayoutInput.hidden = true;
    renameLayoutBtn.hidden = false;
    renameLayoutInput.value = "";
  }
});
renameLayoutInput.addEventListener("blur", commitRename);

// ── Custom layout panel (presets + rows × cols) ───────────────────
const layoutBtn = document.getElementById("layout-btn")!;
const layoutPanel = document.getElementById("layout-panel")!;

layoutBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  layoutPanel.hidden = !layoutPanel.hidden;
});

document.querySelectorAll<HTMLButtonElement>(".layout-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const rows = Number(btn.dataset.rows);
    const cols = Number(btn.dataset.cols);
    dashboard.setLayout(layoutForGrid(rows, cols));
    layoutPanel.hidden = true;
  });
});

const layoutRows = document.getElementById("layout-rows") as HTMLInputElement;
const layoutCols = document.getElementById("layout-cols") as HTMLInputElement;
document.getElementById("layout-apply")!.addEventListener("click", () => {
  const rows = clampTrack(Number(layoutRows.value));
  const cols = clampTrack(Number(layoutCols.value));
  dashboard.setLayout(layoutForGrid(rows, cols));
  layoutPanel.hidden = true;
});

function clampTrack(n: number): number {
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(4, Math.round(n)));
}

// ── Split layout panel (left/right or top/bottom, per-region rows×cols) ─
const splitDirBtns = document.querySelectorAll<HTMLButtonElement>(".split-dir-btn");
let splitDirection: "vertical" | "horizontal" = "vertical";
const splitPrimaryLabel = document.getElementById("split-primary-label")!;
const splitSecondaryLabel = document.getElementById("split-secondary-label")!;

splitDirBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    splitDirection = btn.dataset.dir === "horizontal" ? "horizontal" : "vertical";
    splitDirBtns.forEach((b) => b.classList.toggle("active", b === btn));
    const vertical = splitDirection === "vertical";
    splitPrimaryLabel.textContent = vertical ? "左区" : "上区";
    splitSecondaryLabel.textContent = vertical ? "右区" : "下区";
  });
});

const splitPRows = document.getElementById("split-p-rows") as HTMLInputElement;
const splitPCols = document.getElementById("split-p-cols") as HTMLInputElement;
const splitSRows = document.getElementById("split-s-rows") as HTMLInputElement;
const splitSCols = document.getElementById("split-s-cols") as HTMLInputElement;

document.getElementById("split-apply")!.addEventListener("click", () => {
  const def = layoutForSplit({
    direction: splitDirection,
    primary: { rows: Number(splitPRows.value), cols: Number(splitPCols.value) },
    secondary: { rows: Number(splitSRows.value), cols: Number(splitSCols.value) },
  });
  registerLayout(def);
  dashboard.setLayout(SPLIT_LAYOUT_ID);
  layoutPanel.hidden = true;
});

// ── Per-cell HTF EMA config (system settings, sidebar bottom) ────
type EmaLineConfig = {
  id: string;
  length: number; // EMA period, applied on the cell's own timeframe
  color: string;
  width: number;
  enabled: boolean;
};

const EMA_CFG_KEY = "vela-dashboard-ema-config-v2";
/** Default EMA periods the dashboard starts with: 5/10/20/30/60/120.
 *  Colors follow red/orange/yellow/green/cyan/blue, but the cyan is shifted
 *  toward a bright aqua so it stays clearly distinguishable from the green. */
const DEFAULT_EMA_LINES: Array<{ length: number; color: string }> = [
  { length: 5, color: "#ef5350" }, // red
  { length: 10, color: "#fb8c00" }, // orange
  { length: 20, color: "#fdd835" }, // yellow
  { length: 30, color: "#43a047" }, // green
  { length: 60, color: "#26c6da" }, // bright aqua (cyan, distinct from green)
  { length: 120, color: "#1e88e5" }, // blue
];
const ADD_EMA_DEFAULT_COLOR = "#8e24aa"; // purple — the next hue after blue

/** Per-cell handle maps: cellId -> (lineId -> native indicator handle). */
const emaHandles = new Map<string, Map<string, IndicatorHandle>>();
let emaConfigs: EmaLineConfig[] = loadEmaConfigs();

function defaultEmaConfigs(): EmaLineConfig[] {
  return DEFAULT_EMA_LINES.map((d) => ({
    id: `ema_${d.length}`,
    length: d.length,
    color: d.color,
    width: 2,
    enabled: true,
  }));
}

function loadEmaConfigs(): EmaLineConfig[] {
  try {
    const raw = dashboardStorage.getItem(EMA_CFG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EmaLineConfig[];
      if (
        Array.isArray(parsed) &&
        parsed.every((l) => l && typeof l.length === "number" && typeof l.enabled === "boolean")
      ) {
        return parsed;
      }
    }
  } catch {
    /* corrupted storage → defaults */
  }
  return defaultEmaConfigs();
}

function saveEmaConfigs(): void {
  dashboardStorage.setItem(EMA_CFG_KEY, JSON.stringify(emaConfigs));
}

/** Bring one cell's chart in line with the global EMA config:
 *  create missing handles, update changed ones, remove deleted ones. */
function applyEmaConfigToCell(cell: ChartCell): void {
  const handles = emaHandles.get(cell.id) ?? new Map<string, IndicatorHandle>();
  const liveIds = new Set(emaConfigs.map((c) => c.id));
  for (const [lineId, handle] of [...handles]) {
    if (!liveIds.has(lineId)) {
      handle.remove();
      handles.delete(lineId);
    }
  }
  for (const line of emaConfigs) {
    const inputs: Record<string, InputValue> = {
      length: line.length,
      htf: "", // "" = same timeframe as the cell
      color: line.color,
      lineWidth: line.width,
      enabled: line.enabled,
    };
    const existing = handles.get(line.id);
    if (existing) {
      existing.setInputs(inputs);
    } else {
      const handle = cell.chart.addNativeIndicator(HTF_EMA_TYPE, { inputs });
      handles.set(line.id, handle);
    }
  }
  emaHandles.set(cell.id, handles);
}

function applyAllEmaConfigs(): void {
  for (const cell of dashboard.cells()) applyEmaConfigToCell(cell);
}

function setEmaConfig(config: EmaLineConfig[]): void {
  emaConfigs = config;
  saveEmaConfigs();
  applyAllEmaConfigs();
}

// ── Settings dialog DOM (EMA tab) ────────────────────────────────
const emaLineList = document.getElementById("ema-line-list")!;
const emaAddBtn = document.getElementById("ema-add-btn") as HTMLButtonElement;

function renderEmaLineList(): void {
  emaLineList.innerHTML = "";
  for (const line of emaConfigs) emaLineList.appendChild(buildEmaLineRow(line));
  if (!emaConfigs.length) {
    const tip = document.createElement("div");
    tip.className = "empty-tip";
    tip.textContent = "点击下方按钮添加 EMA 配置";
    emaLineList.appendChild(tip);
  }
}

function updateLine(lineId: string, patch: Partial<EmaLineConfig>): void {
  const idx = emaConfigs.findIndex((l) => l.id === lineId);
  if (idx < 0) return;
  setEmaConfig(emaConfigs.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  // No re-render: keep input focus while typing.
}

function removeEmaLine(lineId: string): void {
  setEmaConfig(emaConfigs.filter((l) => l.id !== lineId));
  renderEmaLineList();
}

function buildEmaLineRow(line: EmaLineConfig): HTMLElement {
  const row = document.createElement("div");
  row.className = "ema-line";
  row.dataset.id = line.id;

  const head = document.createElement("div");
  head.className = "ema-line-head";

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "ema-enabled";
  const enabledBox = document.createElement("input");
  enabledBox.type = "checkbox";
  enabledBox.checked = line.enabled;
  enabledBox.addEventListener("change", () => updateLine(line.id, { enabled: enabledBox.checked }));

  const delBtn = document.createElement("button");
  delBtn.className = "ema-del";
  delBtn.textContent = "✕";
  delBtn.title = "删除这条 EMA";
  delBtn.addEventListener("click", () => removeEmaLine(line.id));

  enabledLabel.append(enabledBox, "显示");
  head.append(enabledLabel, delBtn);

  const fields = document.createElement("div");
  fields.className = "ema-line-fields";
  fields.append(
    numberField("周期", String(line.length), (v) => updateLine(line.id, { length: Math.max(1, Math.round(Number(v) || 1)) })),
    colorField(line.color, (v) => updateLine(line.id, { color: v })),
    widthField(line.width, (v) => updateLine(line.id, { width: Number(v) })),
  );

  row.append(head, fields);
  return row;
}

function numberField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = document.createElement("label");
  wrap.append(label);
  const input = document.createElement("input");
  input.type = "number";
  input.className = "ema-length";
  input.min = "1";
  input.max = "5000";
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  wrap.appendChild(input);
  return wrap;
}

function colorField(value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = document.createElement("label");
  wrap.append("颜色");
  const input = document.createElement("input");
  input.type = "color";
  input.className = "ema-color";
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  wrap.appendChild(input);
  return wrap;
}

function widthField(value: number, onChange: (v: string) => void): HTMLElement {
  const wrap = document.createElement("label");
  wrap.append("线宽");
  const select = document.createElement("select");
  select.className = "ema-width";
  for (let w = 1; w <= 5; w++) {
    const opt = document.createElement("option");
    opt.value = String(w);
    opt.textContent = String(w);
    select.appendChild(opt);
  }
  select.value = String(value);
  select.addEventListener("change", () => onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

emaAddBtn.addEventListener("click", () => {
  const line: EmaLineConfig = {
    id: "ema_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    length: 20,
    color: ADD_EMA_DEFAULT_COLOR,
    width: 2,
    enabled: true,
  };
  setEmaConfig([...emaConfigs, line]);
  renderEmaLineList();
});

// ── Settings dialog: open/close + vertical tab rail ──────────────
const settingsOverlay = document.getElementById("settings-overlay")!;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const settingsCloseBtn = document.getElementById("settings-close-btn") as HTMLButtonElement;

function openSettings(): void {
  settingsOverlay.hidden = false;
  renderEmaLineList();
  editingAlertId = null;
  renderAlertManagement();
}

settingsBtn.addEventListener("click", openSettings);
settingsCloseBtn.addEventListener("click", () => {
  settingsOverlay.hidden = true;
});
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) settingsOverlay.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") settingsOverlay.hidden = true;
});

// ── Help dialog: feature overview + data source explainer ───────
const helpOverlay = document.getElementById("help-overlay")!;
const helpBtn = document.getElementById("help-btn") as HTMLButtonElement;
const helpCloseBtn = document.getElementById("help-close-btn") as HTMLButtonElement;

function openHelp(): void {
  helpOverlay.hidden = false;
}
function closeHelp(): void {
  helpOverlay.hidden = true;
}

helpBtn.addEventListener("click", openHelp);
helpCloseBtn.addEventListener("click", closeHelp);
helpOverlay.addEventListener("click", (e) => {
  if (e.target === helpOverlay) closeHelp();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeHelp();
});

// Vertical tabs: the left rail selects which settings panel is visible.
document.querySelectorAll<HTMLButtonElement>(".settings-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".settings-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".settings-tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.querySelector(`.settings-tab-panel[data-panel="${btn.dataset.panel}"]`)!.classList.add("active");
  });
});

// ── Alert sound maintenance (settings modal "警报声音" tab) ─────
// The sound picker is a dropdown: choosing an option saves it and plays it as
// an instant preview. Presets include the bundled prompts and the user's own
// pinyin-named downloaded tones (playground/public/sounds).
const soundSelect = document.getElementById("sound-select") as HTMLSelectElement;
const soundPreviewBtn = document.getElementById("sound-preview") as HTMLButtonElement;
const soundFileInput = document.getElementById("sound-file") as HTMLInputElement;
const soundResetBtn = document.getElementById("sound-reset") as HTMLButtonElement;

function renderSoundSettings(): void {
  const custom = loadCustomSound();
  const sounds = buildSoundList(custom);
  const selectedId = loadSelectedSoundId();
  soundSelect.innerHTML = "";
  for (const s of sounds) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.builtIn ? s.name : `${s.name}（已上传）`;
    soundSelect.appendChild(opt);
  }
  soundSelect.value = resolveSelectedSound(sounds, selectedId).id;
}

soundSelect.addEventListener("change", () => {
  const sound = resolveSelectedSound(buildSoundList(loadCustomSound()), soundSelect.value);
  saveSelectedSoundId(sound.id);
  playSound(sound);
});

// Explicit preview: plays whatever is currently selected in the dropdown,
// including an uploaded custom sound that is already the active selection.
soundPreviewBtn.addEventListener("click", () => {
  const sound = resolveSelectedSound(buildSoundList(loadCustomSound()), soundSelect.value);
  playSound(sound);
});

soundFileInput.addEventListener("change", () => {
  const file = soundFileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === "string" ? reader.result : "";
    if (!dataUrl) return;
    const sound = saveCustomSound(file.name, dataUrl);
    saveSelectedSoundId(sound.id);
    renderSoundSettings();
    soundFileInput.value = "";
  };
  reader.readAsDataURL(file);
});

soundResetBtn.addEventListener("click", () => {
  clearCustomSound();
  saveSelectedSoundId(DEFAULT_SOUND_ID);
  renderSoundSettings();
});

renderSoundSettings();

// ── Unified alert management (settings modal "告警维护" tab) ─────
const ALERT_SORT_KEY = "vela-dashboard-alert-sort";
const alertsManageList = document.getElementById("alerts-manage-list")!;
const alertSortSelect = document.getElementById("alert-sort") as HTMLSelectElement;

function loadAlertSortMode(): AlertSortMode {
  const v = dashboardStorage.getItem(ALERT_SORT_KEY);
  return v === "symbol-asc" || v === "symbol-desc" || v === "default" ? v : "default";
}

function saveAlertSortMode(mode: AlertSortMode): void {
  dashboardStorage.setItem(ALERT_SORT_KEY, mode);
}

let editingAlertId: string | null = null;

function renderAlertManagement(): void {
  if (editingAlertId) return;
  alertsManageList.innerHTML = "";
  if (!alerts.length) {
    const tip = document.createElement("div");
    tip.className = "alert-empty";
    tip.textContent = "暂无告警，在顶部 🔔 中为当前格子添加价格或爆拉/暴跌告警";
    alertsManageList.appendChild(tip);
    return;
  }
  const mode = alertSortSelect.value as AlertSortMode;
  for (const a of sortAlerts(alerts, mode)) {
    const row = document.createElement("div");
    row.className = "alert-manage-row" + (a.triggered ? " triggered" : "");
    row.dataset.alertId = a.id;
    row.innerHTML = `
      <span class="alert-manage-sym">${escapeHtml(a.symbol)}</span>
      <span class="alert-manage-cond">${escapeHtml(alertConditionText(a))}</span>
      <span class="alert-manage-status">${a.triggered ? "已触发" : "监控中"}</span>
      <button class="alert-manage-btn" data-action="edit" title="修改告警">✎ 修改</button>
      <button class="alert-manage-btn danger" data-action="remove" title="删除告警">✕ 删除</button>`;
    row.querySelector('[data-action="edit"]')!.addEventListener("click", () => startEditAlert(a));
    row.querySelector('[data-action="remove"]')!.addEventListener("click", () => {
      stopAlertRinging(a.id);
      alerts = alerts.filter((x) => x.id !== a.id);
      saveAlerts();
      renderAlerts();
    });
    alertsManageList.appendChild(row);
  }
}

function startEditAlert(a: Alert): void {
  editingAlertId = a.id;
  const row = document.createElement("div");
  row.className = "alert-manage-edit";
  if (a.kind === "price-up" || a.kind === "price-down") {
    row.innerHTML = `
      <input class="edit-symbol" type="text" value="${escapeHtml(a.symbol)}" autocomplete="off" />
      <input class="edit-price" type="number" value="${a.price}" min="0" step="any" />
      <select class="edit-direction">
        <option value="above" ${a.kind === "price-up" ? "selected" : ""}>上穿</option>
        <option value="below" ${a.kind === "price-down" ? "selected" : ""}>下穿</option>
      </select>
      <span class="edit-actions">
        <button class="alert-manage-btn primary" data-action="save">保存</button>
        <button class="alert-manage-btn" data-action="cancel">取消</button>
      </span>`;
  } else {
    row.innerHTML = `
      <input class="edit-symbol" type="text" value="${escapeHtml(a.symbol)}" autocomplete="off" />
      <select class="edit-window">
        ${ALERT_WINDOW_MINUTES.map((m) => `<option value="${m}" ${a.windowMinutes === m ? "selected" : ""}>${m} 分钟</option>`).join("")}
      </select>
      <input class="edit-threshold" type="number" value="${a.thresholdPct}" min="0.1" step="0.1" />
      <select class="edit-direction">
        <option value="surge" ${a.kind === "surge" ? "selected" : ""}>爆拉 ↑</option>
        <option value="dump" ${a.kind === "dump" ? "selected" : ""}>暴跌 ↓</option>
      </select>
      <span class="edit-actions">
        <button class="alert-manage-btn primary" data-action="save">保存</button>
        <button class="alert-manage-btn" data-action="cancel">取消</button>
      </span>`;
  }
  row.querySelector('[data-action="save"]')!.addEventListener("click", () => saveEditAlert(a.id, row));
  row.querySelector('[data-action="cancel"]')!.addEventListener("click", cancelEditAlert);
  const existing = alertsManageList.querySelector(`[data-alert-id="${a.id}"]`);
  if (existing) existing.replaceWith(row);
}

function saveEditAlert(id: string, row: HTMLDivElement): void {
  const symbol = (row.querySelector(".edit-symbol") as HTMLInputElement).value.trim().toUpperCase();
  const direction = (row.querySelector(".edit-direction") as HTMLSelectElement).value;
  const target = alerts.find((x) => x.id === id);
  if (!target || !symbol) return;
  if (target.kind === "price-up" || target.kind === "price-down") {
    const price = Number((row.querySelector(".edit-price") as HTMLInputElement).value);
    if (!Number.isFinite(price) || price <= 0) return;
    target.symbol = symbol;
    target.price = price;
    target.kind = direction === "below" ? "price-down" : "price-up";
  } else {
    const threshold = Number((row.querySelector(".edit-threshold") as HTMLInputElement).value);
    const windowMinutes = Number((row.querySelector(".edit-window") as HTMLSelectElement).value);
    if (!Number.isFinite(threshold) || threshold <= 0) return;
    target.symbol = symbol;
    target.thresholdPct = threshold;
    target.windowMinutes = windowMinutes;
    target.kind = direction === "dump" ? "dump" : "surge";
  }
  target.triggered = false;
  stopAlertRinging(id);
  editingAlertId = null;
  saveAlerts();
  renderAlerts();
}

function cancelEditAlert(): void {
  editingAlertId = null;
  renderAlertManagement();
}

alertSortSelect.addEventListener("change", () => {
  saveAlertSortMode(alertSortSelect.value as AlertSortMode);
  renderAlertManagement();
});
alertSortSelect.value = loadAlertSortMode();
renderAlertManagement();

// Keep per-cell handles (EMA + timeframe dropdown) in step with layout switches.
dashboard.on("cell:created", ({ id }) => {
  const cell = dashboard.cell(id);
  if (cell) {
    applyEmaConfigToCell(cell);
    cellTimeframeSelects.set(id, buildCellTimeframeSelect(cell));
    // A ringing alert's symbol may land on this new cell after a layout switch —
    // carry the visual cue over so the alert stays visible on the rebuilt grid.
    if (cellRingCounter.has(cell.symbol)) {
      cell.host.classList.add("alert-ringing");
      ensureCellBadge(cell, cell.symbol);
    }
  }
});
dashboard.on("cell:destroyed", ({ id }) => {
  // The cell's chart is gone with it; just drop the handle maps.
  cellTimeframeSelects.delete(id);
  emaHandles.delete(id);
  pineMount.drop(id);
});

// ── Binance connection status & disconnect alert ─────────────────
// A lightweight `!miniTicker@arr` socket probes the Binance feed every second:
// green blinking = ok, yellow = slow, red = disconnected (docs/plans/alerts.md).
const connDot = document.getElementById("conn-dot") as HTMLSpanElement;
const connAlert = document.getElementById("conn-alert") as HTMLDivElement;
const connAlertClose = document.getElementById("conn-alert-close") as HTMLButtonElement;

function setConnState(state: "ok" | "slow" | "down"): void {
  connDot.classList.toggle("blink", state === "ok");
  connDot.classList.toggle("slow", state === "slow");
  connDot.classList.toggle("down", state === "down");
  connDot.title = `币安连接：${state === "ok" ? "正常" : state === "slow" ? "速度慢" : "已断开"}`;
}

function speakAlert(text: string): void {
  try {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* speech synthesis unavailable */
  }
}

const connectionMonitor = new ConnectionMonitor(
  {
    url: "wss://stream.binance.com:9443/ws/!miniTicker@arr",
    slowLatencyMs: 3000,
    stallTimeoutMs: 10000,
  },
  {
    onState: setConnState,
    onDisconnected: () => {
      connAlert.hidden = false;
      playAlertSound();
      speakAlert("币安连接已断开");
      dashboard.toast("币安连接已断开，正在自动重连…", "error", 0);
      notifyDesktop("币安连接断开", "币安连接已断开，正在自动重连…");
    },
    onRecovered: () => {
      connAlert.hidden = true;
      speakAlert("币安连接已恢复");
      dashboard.toast("币安连接已恢复", "info", 3000);
      notifyDesktop("币安连接恢复", "币安连接已恢复");
    },
  },
);
connectionMonitor.start();

connAlertClose.addEventListener("click", () => {
  connAlert.hidden = true;
});

// ── Pine Script editor & saved scripts (bottom dock) ────────────
type PineScriptEntry = { id: string; name: string; source: string };
const PINE_KEY = "vela-dashboard-pine-scripts";
const pineNameInput = document.getElementById("pine-name-input") as HTMLInputElement;
const pineEditor = document.getElementById("pine-editor") as HTMLTextAreaElement;
const pineSaveBtn = document.getElementById("pine-save-btn") as HTMLButtonElement;
const pineApplyBtn = document.getElementById("pine-apply-btn") as HTMLButtonElement;
const pineScriptSelect = document.getElementById("pine-script-select") as HTMLSelectElement;
const pineNewBtn = document.getElementById("pine-new-btn") as HTMLButtonElement;
const pineDeleteBtn = document.getElementById("pine-delete-btn") as HTMLButtonElement;
const pineClearBtn = document.getElementById("pine-clear-btn") as HTMLButtonElement;
const pineStatus = document.getElementById("pine-status")!;

// Tracks the single applied Pine script across grid cells. Applying a script
// replaces the previous one (no duplicate stacking);「清空脚本」shares this teardown.
const pineMount = new PineIndicatorMount();
let pineApplyGeneration = 0;

let pineScripts: PineScriptEntry[] = loadPineScripts();
let selectedPineId: string | null = null;

// Seed the bundled Pine v5 strategy on first run.
if (!pineScripts.length) {
  const bundled: PineScriptEntry = {
    id: "pine_default_hunter",
    name: "神级反转猎手（v5）",
    source: pineScriptSource,
  };
  pineScripts.push(bundled);
  savePineScripts();
}

function loadPineScripts(): PineScriptEntry[] {
  try {
    const raw = dashboardStorage.getItem(PINE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PineScriptEntry[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* corrupted storage → empty */
  }
  return [];
}

function savePineScripts(): void {
  dashboardStorage.setItem(PINE_KEY, JSON.stringify(pineScripts));
}

function setPineStatus(message: string, kind: "error" | "ok" | ""): void {
  pineStatus.textContent = message;
  pineStatus.className = kind;
}

/** Load a saved script into the editor and mark it selected. */
function loadPineScriptEntry(script: PineScriptEntry): void {
  selectedPineId = script.id;
  pineScriptSelect.value = script.id;
  pineNameInput.value = script.name;
  pineEditor.value = script.source;
  setPineStatus("", "");
}

/** Rebuild the dropdown options, keeping the current selection when possible. */
function renderPineScripts(): void {
  pineScriptSelect.innerHTML = "";
  if (!pineScripts.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "暂无脚本";
    pineScriptSelect.appendChild(placeholder);
    pineScriptSelect.disabled = true;
    selectedPineId = null;
    return;
  }
  pineScriptSelect.disabled = false;
  for (const script of pineScripts) {
    const opt = document.createElement("option");
    opt.value = script.id;
    opt.textContent = script.name;
    opt.title = script.name;
    pineScriptSelect.appendChild(opt);
  }
  if (selectedPineId && pineScripts.some((s) => s.id === selectedPineId)) {
    pineScriptSelect.value = selectedPineId;
  } else {
    selectedPineId = pineScripts[0]!.id;
    pineScriptSelect.value = selectedPineId;
  }
}

// Load the initial script (the bundled one on first run).
loadPineScriptEntry(pineScripts[0]!);

function applyPineScript(source: string): void {
  const cells = dashboard.cells();
  if (!cells.length) {
    setPineStatus("没有可应用的图表格子", "error");
    return;
  }
  // Apply = clear-then-remount (idempotent): the previous applied script is removed
  // first, so repeated「应用」never stacks duplicate instances (docs/plans/pine-scripting.md).
  const generation = ++pineApplyGeneration;
  let settled = 0;
  let okCount = 0;
  let firstError = "";
  const total = cells.length;
  const finalize = (): void => {
    if (generation !== pineApplyGeneration) return; // superseded by a newer apply/clear
    settled += 1;
    if (settled < total) return;
    if (okCount === total) {
      setPineStatus(`脚本已应用到全部 ${total} 个窗口`, "ok");
    } else if (okCount > 0) {
      setPineStatus(`脚本应用：${okCount}/${total} 成功，失败：${firstError || "未知错误"}`, "error");
    } else {
      setPineStatus("脚本运行失败：" + (firstError || "未知错误"), "error");
    }
  };

  const results = pineMount.apply(
    cells.map((cell) => ({ id: cell.id, chart: cell.chart })),
    source,
  );

  for (const result of results) {
    if (!result.ok) {
      if (!firstError) firstError = result.error instanceof Error ? result.error.message : String(result.error);
      finalize();
      continue;
    }
    // Vela ships no scripting engine — the AGPL `@luxalgo/vela-pinets` addon is wired in
    // by a host via `cell.chart.registerEngine('pine', …)`. Engine errors arrive on the
    // handle's `error` event, success on `ready`.
    let unsubReady: () => void = () => {};
    let unsubError: () => void = () => {};
    unsubReady = result.handle.on("ready", () => {
      okCount += 1;
      unsubReady();
      unsubError();
      finalize();
    });
    unsubError = result.handle.on("error", ({ error: err }) => {
      if (!firstError) firstError = err instanceof Error ? err.message : String(err);
      unsubReady();
      unsubError();
      finalize();
    });
  }
  setPineStatus(`脚本已提交到 ${total} 个窗口…`, "");
}

pineScriptSelect.addEventListener("change", () => {
  const script = pineScripts.find((s) => s.id === pineScriptSelect.value);
  if (script) loadPineScriptEntry(script);
});

pineNewBtn.addEventListener("click", () => {
  selectedPineId = null;
  pineScriptSelect.value = "";
  pineNameInput.value = "";
  pineEditor.value = "";
  pineNameInput.focus();
  setPineStatus("输入名称后点保存，创建新脚本", "");
});

pineSaveBtn.addEventListener("click", () => {
  const name = pineNameInput.value.trim();
  const source = pineEditor.value.trim();
  if (!name) {
    setPineStatus("请先填写脚本名称", "error");
    return;
  }
  if (!source) {
    setPineStatus("脚本内容为空", "error");
    return;
  }
  if (selectedPineId) {
    const entry = pineScripts.find((s) => s.id === selectedPineId);
    if (entry) {
      entry.name = name;
      entry.source = source;
    }
  } else {
    const entry: PineScriptEntry = {
      id: "pine_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name,
      source,
    };
    pineScripts.push(entry);
    selectedPineId = entry.id;
  }
  savePineScripts();
  renderPineScripts();
  setPineStatus("脚本已保存", "ok");
});

pineDeleteBtn.addEventListener("click", () => {
  if (!selectedPineId) {
    setPineStatus("没有选中的脚本可删除", "");
    return;
  }
  pineScripts = pineScripts.filter((s) => s.id !== selectedPineId);
  savePineScripts();
  selectedPineId = null;
  renderPineScripts();
  const next = pineScripts[0] ?? null;
  if (next) {
    loadPineScriptEntry(next);
    setPineStatus("脚本已删除", "ok");
  } else {
    pineNameInput.value = "";
    pineEditor.value = "";
    setPineStatus("脚本已删除，暂无脚本", "");
  }
});

pineApplyBtn.addEventListener("click", () => {
  const source = pineEditor.value.trim();
  if (!source) {
    setPineStatus("请先编写脚本内容", "error");
    return;
  }
  applyPineScript(source);
});

pineClearBtn.addEventListener("click", () => {
  pineApplyGeneration += 1; // invalidate any in-flight apply settlement
  const removed = pineMount.clear();
  if (removed > 0) {
    setPineStatus(`已清空全部 ${removed} 个窗口的 Pine 脚本`, "ok");
  } else {
    setPineStatus("当前没有已应用的 Pine 脚本", "");
  }
});

// Pine dock: expand/collapse + drag the top splitter to resize height.
const pineDock = document.getElementById("pine-dock")!;
const pineDockBar = document.getElementById("pine-dock-bar")!;
const pineDockToggle = document.getElementById("pine-dock-toggle") as HTMLButtonElement;
const pineResize = document.getElementById("pine-resize")!;
const PINE_DOCK_MIN_HEIGHT = 100;
const PINE_DOCK_MAX_RATIO = 0.75;
let lastPineDockHeight = 280;

pineDockBar.addEventListener("click", () => {
  const collapsed = pineDock.classList.toggle("collapsed");
  if (collapsed) {
    lastPineDockHeight = pineDock.getBoundingClientRect().height;
    pineDock.style.height = "auto";
  } else {
    pineDock.style.height = lastPineDockHeight + "px";
  }
  pineDockToggle.textContent = collapsed ? "展开 ▴" : "收起 ▾";
});

pineResize.addEventListener("pointerdown", (e: PointerEvent) => {
  e.preventDefault();
  pineResize.setPointerCapture(e.pointerId);
  const startY = e.clientY;
  const startHeight = pineDock.getBoundingClientRect().height;
  const parent = pineDock.parentElement;
  const maxHeight = parent ? Math.floor(parent.clientHeight * PINE_DOCK_MAX_RATIO) : 600;
  const onMove = (ev: PointerEvent) => {
    // Drag up (negative delta) grows the dock; drag down shrinks it.
    const next = Math.min(maxHeight, Math.max(PINE_DOCK_MIN_HEIGHT, startHeight + (startY - ev.clientY)));
    pineDock.style.height = next + "px";
  };
  const onUp = () => {
    pineResize.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  pineResize.classList.add("dragging");
  document.body.style.cursor = "ns-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
});

// ── Init ─────────────────────────────────────────────────────────
renderGroups();
renderTokens();
// The workspace starts on the fixed default view — pin the dropdown to it.
activeLayoutId = DEFAULT_OPTION_VALUE;
renderLayoutPicker(DEFAULT_OPTION_VALUE);
initHoldingsView();
initPineScreener({ onOpenSymbol: (ticker) => showScreenerPreview(ticker) });
initScreenerPreviewWindow();
initTradePlan({
  getActiveChart: () => {
    const cell = activeCellId ? dashboard.cell(activeCellId) : null;
    if (!cell) return null;
    const ticker = cell.symbol || "";
    if (!ticker) return null;
    const name = baseSymbolOf(ticker);
    let screenshot: string | null = null;
    try {
      screenshot = cell.chart.renderer.screenshot() ?? null;
    } catch {
      // The cell may be mid-layout or already destroyed — allow a text-only plan.
    }
    return { ticker, name, screenshot };
  },
});
showKlineView();
renderAlerts();
renderEmaLineList();
applyAllEmaConfigs();
// Initial cells predate the `cell:created` handler — build their timeframes now.
for (const cell of dashboard.cells()) {
  if (!cellTimeframeSelects.has(cell.id)) {
    cellTimeframeSelects.set(cell.id, buildCellTimeframeSelect(cell));
  }
}
renderPineScripts();
void loadSymbols();

// The storage cache is authoritative once IndexedDB hydration completes (it may
// have restored data that the synchronous localStorage mirror lost). Reload
// every persisted model and re-render so the durable copy wins.
dashboardStorage.onHydrated(() => {
  groups = loadGroups();
  layouts = loadLayouts();
  backfillLayoutGrids();
  alerts = loadAlerts();
  emaConfigs = loadEmaConfigs();
  pineScripts = loadPineScripts();
  currentTheme = loadTheme();
  applyTheme(currentTheme);
  reloadHoldingsData();
  renderGroups();
  renderTokens();
  renderLayoutPicker(activeLayoutId);
  renderAlerts();
  renderEmaLineList();
  applyAllEmaConfigs();
  renderPineScripts();
  refreshPineScreener();
});

// Click outside popovers (layout / alerts / panels) to close.
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("#layout-custom-wrap")) layoutPanel.hidden = true;
  if (!t.closest("#alerts-wrap")) alertsPanel.hidden = true;
  if (!t.closest("#panels-wrap")) panelsPanel.hidden = true;
});