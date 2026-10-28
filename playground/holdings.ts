// Holdings view: editable position table + USDT/RMB denomination toggle +
// share bar charts. Current prices come from the Binance REST ticker/price
// endpoint (same one the alert poller uses); the USDT->CNY rate comes from
// CoinGecko with a manual fallback configured in Settings -> 持仓设置.
import {
  baseSymbolOf,
  computeRow,
  computeTotals,
  formatMoney,
  formatPrice,
  formatProfitPct,
  formatQuantity,
  profitClass,
  type Currency,
  type Holding,
  type HoldingRow,
} from "./holdingsCore";
import { CRYPTO_LOGO_EXT, logoUrlFor } from "./cryptoLogos";
import { dashboardStorage } from "./idbStorage";

const HOLDINGS_KEY = "vela-dashboard-holdings-v1";
const RATE_KEY = "vela-dashboard-holdings-rate-v1";
const CURRENCY_KEY = "vela-dashboard-holdings-currency-v1";
const SPLIT_KEY = "vela-dashboard-holdings-split-v1";
const PRICE_REFRESH_MS = 5000;
const RATE_REFRESH_MS = 30 * 60 * 1000;
const DEFAULT_RATE = 6.65;

type RateConfig = { mode: "auto" | "manual"; manual: number; lastAuto: number | null };

// ── State ────────────────────────────────────────────────────────
let holdings: Holding[] = loadHoldings();
let rateConfig: RateConfig = loadRateConfig();
let currency: Currency = loadCurrency();
// Last-known prices persist across failed polls so totals don't flicker.
const prices = new Map<string, number>([["USDT", 1]]);

// DOM refs, bound lazily on init.
let tbody: HTMLElement | null = null;
let amountChart: HTMLElement | null = null;
let pieChart: HTMLElement | null = null;
let rateDisplay: HTMLElement | null = null;
let holdingsViewActive = false;
// Registered by dashboard.ts: opens the shared alerts panel pre-filled with a
// holding's symbol so the row action can start a price alert in one click.
let alertQuickSetHandler: ((symbol: string) => void) | null = null;

/** Let dashboard.ts supply the "quick set alert" bridge without a circular import. */
export function setAlertQuickSetHandler(fn: (symbol: string) => void): void {
  alertQuickSetHandler = fn;
}

// ── Persistence (IndexedDB-backed, see idbStorage.ts) ───────────
function loadHoldings(): Holding[] {
  try {
    const raw = dashboardStorage.getItem(HOLDINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Holding[];
      if (
        Array.isArray(parsed) &&
        parsed.every((h) => h && typeof h.id === "string" && typeof h.symbol === "string")
      ) {
        return parsed.map((h) => ({
          id: h.id,
          symbol: h.symbol,
          buyDate: typeof h.buyDate === "string" ? h.buyDate : "",
          quantity: Number(h.quantity) || 0,
          buyPrice: Number(h.buyPrice) || 0,
          remark: typeof h.remark === "string" ? h.remark : "",
        }));
      }
    }
  } catch {
    /* corrupted storage -> empty */
  }
  return [];
}

function saveHoldings(): void {
  dashboardStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
}

function loadRateConfig(): RateConfig {
  try {
    const raw = dashboardStorage.getItem(RATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RateConfig;
      if (parsed && (parsed.mode === "auto" || parsed.mode === "manual")) {
        return {
          mode: parsed.mode,
          manual: Number(parsed.manual) > 0 ? Number(parsed.manual) : DEFAULT_RATE,
          lastAuto: typeof parsed.lastAuto === "number" ? parsed.lastAuto : null,
        };
      }
    }
  } catch {
    /* corrupted storage -> default */
  }
  return { mode: "auto", manual: DEFAULT_RATE, lastAuto: null };
}

function saveRateConfig(): void {
  dashboardStorage.setItem(RATE_KEY, JSON.stringify(rateConfig));
}

function loadCurrency(): Currency {
  const v = dashboardStorage.getItem(CURRENCY_KEY);
  return v === "RMB" ? "RMB" : "USDT";
}

function saveCurrency(): void {
  dashboardStorage.setItem(CURRENCY_KEY, currency);
}

// ── Rate & prices ────────────────────────────────────────────────
function currentRate(): number {
  return rateConfig.mode === "auto" ? (rateConfig.lastAuto ?? rateConfig.manual) : rateConfig.manual;
}

async function refreshRate(): Promise<void> {
  if (rateConfig.mode !== "auto") return;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny,usd",
    );
    if (!res.ok) return;
    const data = (await res.json()) as { tether?: { cny?: number } };
    const cny = Number(data.tether?.cny);
    if (Number.isFinite(cny) && cny > 0) {
      rateConfig.lastAuto = cny;
      saveRateConfig();
      updateRateSettings();
      updateRateDisplay();
      updateDerivedValues();
    }
  } catch {
    /* keep the last known rate */
  }
}

async function pollPrices(): Promise<void> {
  const symbols = [...new Set(holdings.map((h) => h.symbol).filter((s) => s && s !== "USDT"))];
  if (!symbols.length) return;
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return; // Binance error body (e.g. invalid symbol)
    for (const d of data) {
      const item = d as { symbol?: string; price?: string };
      if (typeof item.symbol === "string" && item.price !== undefined) {
        const p = Number(item.price);
        if (Number.isFinite(p) && p >= 0) prices.set(item.symbol, p);
      }
    }
    updateDerivedValues();
  } catch {
    /* keep the last known prices */
  }
}

// ── Helpers ──────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return "";
  if (s !== "USDT" && !s.endsWith("USDT")) return s + "USDT";
  return s;
}

const BADGE_PALETTE = [
  "#f0b90b", "#089981", "#f23645", "#8e24aa", "#1e88e5",
  "#fb8c00", "#26c6da", "#43a047", "#e53935", "#5e35b1",
];

function badgeColor(base: string): string {
  let hash = 0;
  for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return BADGE_PALETTE[hash % BADGE_PALETTE.length]!;
}

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── Rendering ─────────────────────────────────────────────────
function renderHoldingsTable(): void {
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!holdings.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="12" class="empty-tip">暂无持仓，点击右上角「＋ 添加持仓」开始记录</td>`;
    tbody.appendChild(tr);
  } else {
    for (const h of holdings) tbody.appendChild(createHoldingRow(h));
  }
  updateDerivedValues();
}

function createHoldingRow(h: Holding): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.holdingId = h.id;
  const base = baseSymbolOf(h.symbol);
  const logo = logoUrlFor(base);
  const mult = currency === "RMB" ? currentRate() : 1;
  tr.innerHTML = `
    <td>${logo ? `<img class="coin-logo" src="${logo}" alt="${escapeHtml(base)}" loading="lazy">` : `<span class="coin-badge" style="background:${badgeColor(base)}">${escapeHtml(base.slice(0, 2))}</span>`}</td>
    <td><input class="h-symbol" type="text" value="${escapeHtml(h.symbol)}" title="币安交易对，如 TRXUSDT" autocomplete="off"></td>
    <td><input class="h-date" type="date" value="${escapeHtml(h.buyDate)}"></td>
    <td><input class="h-qty" type="number" step="any" min="0" value="${h.quantity}" autocomplete="off"></td>
    <td><input class="h-price" type="number" step="any" min="0" value="${(h.buyPrice * mult).toFixed(4)}" autocomplete="off"></td>
    <td class="derived" data-field="currentPrice">—</td>
    <td class="derived" data-field="buyValue">—</td>
    <td class="derived" data-field="currentValue">—</td>
    <td class="derived" data-field="profitAmount">—</td>
    <td class="derived" data-field="profitPct">—</td>
    <td><input class="h-remark" type="text" value="${escapeHtml(h.remark)}" placeholder="备注" autocomplete="off"></td>
    <td class="holdings-actions">
      <button class="holdings-alert-btn" type="button" title="设置预警">🔔</button>
      <button class="holdings-remove-btn" type="button" title="删除">✕</button>
    </td>`;

  const sym = tr.querySelector(".h-symbol") as HTMLInputElement;
  sym.addEventListener("change", () => {
    const next = normalizeSymbol(sym.value);
    h.symbol = next;
    sym.value = next;
    saveHoldings();
    void pollPrices();
  });

  const dateInput = tr.querySelector(".h-date") as HTMLInputElement;
  dateInput.addEventListener("change", () => {
    h.buyDate = dateInput.value;
    saveHoldings();
  });

  const qty = tr.querySelector(".h-qty") as HTMLInputElement;
  qty.addEventListener("input", () => {
    h.quantity = Number(qty.value) || 0;
    saveHoldings();
    updateDerivedValues();
  });

  const price = tr.querySelector(".h-price") as HTMLInputElement;
  price.addEventListener("input", () => {
    h.buyPrice = (Number(price.value) || 0) / mult;
    saveHoldings();
    updateDerivedValues();
  });

  const remark = tr.querySelector(".h-remark") as HTMLInputElement;
  remark.addEventListener("input", () => {
    h.remark = remark.value;
    saveHoldings();
  });

  tr.querySelector(".holdings-alert-btn")!.addEventListener("click", (e) => {
    e.stopPropagation();
    alertQuickSetHandler?.(h.symbol);
  });

  tr.querySelector(".holdings-remove-btn")!.addEventListener("click", () => {
    if (window.confirm(`删除 ${baseSymbolOf(h.symbol)} 这条持仓？`)) {
      holdings = holdings.filter((x) => x.id !== h.id);
      saveHoldings();
      renderHoldingsTable();
      refreshHoldingsCount();
    }
  });

  return tr;
}

function setDerived(tr: HTMLElement, field: string, text: string): void {
  const el = tr.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (el) el.textContent = text;
}

function updateDerivedValues(): void {
  if (!tbody || !holdingsViewActive) return;
  const rate = currentRate();
  const mult = currency === "RMB" ? rate : 1;
  const rows = holdings.map((h) => computeRow(h, prices.get(h.symbol) ?? 0));
  const totals = computeTotals(rows);

  for (const row of rows) {
    const tr = tbody.querySelector<HTMLTableRowElement>(`tr[data-holding-id="${row.holding.id}"]`);
    if (!tr) continue;
    setDerived(tr, "buyValue", formatMoney(row.buyMarketValue, currency, rate));
    const pctEl = tr.querySelector<HTMLElement>('[data-field="profitPct"]');
    const profitEl = tr.querySelector<HTMLElement>('[data-field="profitAmount"]');
    if (Number.isFinite(row.profitPct)) {
      setDerived(tr, "currentPrice", formatPrice(row.currentPrice * mult));
      setDerived(tr, "currentValue", formatMoney(row.currentMarketValue, currency, rate));
      if (pctEl) {
        pctEl.textContent = formatProfitPct(row.profitPct);
        pctEl.className = `derived ${profitClass(row.profitPct)}`;
      }
      if (profitEl) {
        profitEl.textContent = `${row.profit >= 0 ? "+" : ""}${formatMoney(row.profit, currency, rate)}`;
        profitEl.className = `derived ${profitClass(row.profit)}`;
      }
    } else {
      setDerived(tr, "currentPrice", "—");
      setDerived(tr, "currentValue", "—");
      if (pctEl) {
        pctEl.textContent = "—";
        pctEl.className = "derived";
      }
      if (profitEl) {
        profitEl.textContent = "—";
        profitEl.className = "derived";
      }
    }
  }

  const buyEl = document.getElementById("total-buy-value");
  const nowEl = document.getElementById("total-now-value");
  const pctEl = document.getElementById("total-profit-pct");
  const amountEl = document.getElementById("total-profit-amount");
  if (buyEl) buyEl.textContent = formatMoney(totals.buyMarketValue, currency, rate);
  if (nowEl) nowEl.textContent = formatMoney(totals.currentMarketValue, currency, rate);
  if (pctEl) {
    pctEl.textContent = formatProfitPct(totals.profitPct);
    pctEl.className = profitClass(totals.profitPct);
  }
  if (amountEl) {
    amountEl.textContent = `${totals.profit >= 0 ? "+" : ""}${formatMoney(totals.profit, currency, rate)}`;
    amountEl.className = profitClass(totals.profit);
  }

  renderCharts(rows);
}

function renderCharts(rows: HoldingRow[]): void {
  if (!amountChart || !pieChart) return;
  const total = rows.reduce((s, r) => s + r.currentMarketValue, 0);
  const rate = currentRate();
  amountChart.innerHTML = "";
  pieChart.innerHTML = "";
  if (!rows.length) {
    amountChart.innerHTML = `<div class="empty-tip">暂无持仓</div>`;
    pieChart.innerHTML = `<div class="empty-tip">暂无持仓</div>`;
    return;
  }
  for (const r of rows) {
    const base = baseSymbolOf(r.holding.symbol);
    const amountPct = total > 0 ? (r.currentMarketValue / total) * 100 : 0;
    // 百分比与金额紧挨显示在柱顶，柱体用该币自己的颜色，底部为币种名。
    const amountText = `${amountPct.toFixed(1)}%  ${formatMoney(r.currentMarketValue, currency, rate)}`;
    amountChart.appendChild(barColumn(base, amountPct, amountText, badgeColor(base)));
  }
  renderPieChart(rows, total);
}

// 资产占比环形饼图：每种币一种颜色，图例显示币种 / 比例 / 金额。
function renderPieChart(rows: HoldingRow[], total: number): void {
  if (!pieChart) return;
  const rate = currentRate();
  const mult = currency === "RMB" ? rate : 1;
  const sorted = [...rows].sort((a, b) => b.currentMarketValue - a.currentMarketValue);
  const CIRCUMFERENCE = 2 * Math.PI * 45; // r=45 in the 120x120 viewBox
  let cumulative = 0;
  const segments = sorted
    .map((r) => {
      const base = baseSymbolOf(r.holding.symbol);
      const pct = total > 0 ? (r.currentMarketValue / total) * 100 : 0;
      const len = (pct / 100) * CIRCUMFERENCE;
      const seg = {
        base,
        color: badgeColor(base),
        pct,
        len,
        offset: cumulative,
        amount: formatMoney(r.currentMarketValue, currency, rate),
      };
      cumulative += len;
      return seg;
    })
    .filter((s) => s.pct > 0.01);

  const svgSegments = segments
    .map(
      (s) =>
        `<circle cx="60" cy="60" r="45" fill="none" stroke="${s.color}" stroke-width="18" ` +
        `stroke-dasharray="${s.len.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}" ` +
        `stroke-dashoffset="${(-s.offset).toFixed(2)}" />`,
    )
    .join("");
  const legend = segments
    .map(
      (s) =>
        `<div class="pie-legend-row">` +
        `<span class="pie-color" style="background:${s.color}"></span>` +
        `<span class="pie-symbol">${escapeHtml(s.base)}</span>` +
        `<span class="pie-pct">${s.pct.toFixed(1)}%</span>` +
        `<span class="pie-amount">${s.amount}</span>` +
        `</div>`,
    )
    .join("");

  pieChart.innerHTML = `
    <div class="pie-wrap">
      <svg class="pie-svg" viewBox="0 0 120 120" role="img" aria-label="资产占比饼图">
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r="45" fill="none" stroke="var(--border)" stroke-width="18" />
          ${svgSegments}
        </g>
        <text x="60" y="57" text-anchor="middle" class="pie-total-label">${escapeHtml(formatMoney(total, currency, rate))}</text>
        <text x="60" y="72" text-anchor="middle" class="pie-total-sub">总资产</text>
      </svg>
      <div class="pie-legend">${legend}</div>
    </div>`;
}

function barColumn(label: string, heightPct: number, valueText: string, color: string): HTMLElement {
  const col = document.createElement("div");
  col.className = "bar-column";
  const height = Math.max(0, Math.min(100, heightPct)).toFixed(1);
  col.title = `${label} ${valueText}`;
  col.innerHTML = `
    <span class="bar-col-value">${escapeHtml(valueText)}</span>
    <div class="bar-col-track"><div class="bar-col-fill" style="height:${height}%;background:${color}"></div></div>
    <span class="bar-col-label">${escapeHtml(label)}</span>`;
  return col;
}

// ── Toolbar: currency toggle + add form ─────────────────────────
function updateCurrencyToggle(): void {
  document.querySelectorAll<HTMLButtonElement>(".currency-toggle button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.currency === currency);
  });
}

function initCurrencyToggle(): void {
  document.querySelectorAll<HTMLButtonElement>(".currency-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      currency = btn.dataset.currency === "RMB" ? "RMB" : "USDT";
      saveCurrency();
      updateCurrencyToggle();
      // Re-render inputs in the newly selected denomination (USDT stays the base).
      renderHoldingsTable();
    });
  });
}

function updateRateDisplay(): void {
  if (rateDisplay) rateDisplay.textContent = `1 USDT = ${currentRate().toFixed(2)} CNY`;
}

function showAddForm(): void {
  const form = document.getElementById("add-holding-form");
  if (!form) return;
  form.hidden = false;
  const symbolInput = document.getElementById("new-symbol") as HTMLInputElement;
  if (symbolInput) symbolInput.focus();
}

function hideAddForm(): void {
  const form = document.getElementById("add-holding-form");
  if (!form) return;
  form.hidden = true;
  for (const id of ["new-symbol", "new-qty", "new-price", "new-date", "new-remark"]) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = "";
  }
  const dateInput = document.getElementById("new-date") as HTMLInputElement | null;
  if (dateInput) dateInput.value = today();
}

function confirmAdd(): void {
  const symbolInput = document.getElementById("new-symbol") as HTMLInputElement;
  const qtyInput = document.getElementById("new-qty") as HTMLInputElement;
  const priceInput = document.getElementById("new-price") as HTMLInputElement;
  const dateInput = document.getElementById("new-date") as HTMLInputElement;
  const remarkInput = document.getElementById("new-remark") as HTMLInputElement;
  const symbol = normalizeSymbol(symbolInput?.value ?? "");
  const quantity = Number(qtyInput?.value);
  const buyPrice = Number(priceInput?.value);
  const buyDate = dateInput?.value || today();
  if (!symbol) {
    symbolInput?.focus();
    return;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    qtyInput?.focus();
    return;
  }
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
    priceInput?.focus();
    return;
  }
  holdings.push({
    id: "h_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    symbol,
    buyDate,
    quantity,
    buyPrice,
    remark: remarkInput?.value.trim() ?? "",
  });
  saveHoldings();
  hideAddForm();
  renderHoldingsTable();
  refreshHoldingsCount();
  void pollPrices();
}

// ── Settings modal: "持仓设置" tab ──────────────────────────────
function updateRateSettings(): void {
  const lastAutoEl = document.getElementById("rate-last-auto");
  if (lastAutoEl) {
    lastAutoEl.textContent = rateConfig.lastAuto !== null ? rateConfig.lastAuto.toFixed(2) : "—";
  }
}

function initRateSettings(): void {
  const modeSelect = document.getElementById("rate-mode") as HTMLSelectElement | null;
  const manualInput = document.getElementById("rate-manual") as HTMLInputElement | null;
  if (!modeSelect || !manualInput) return;
  modeSelect.value = rateConfig.mode;
  manualInput.value = String(rateConfig.manual);
  updateRateSettings();

  modeSelect.addEventListener("change", () => {
    rateConfig.mode = modeSelect.value === "manual" ? "manual" : "auto";
    saveRateConfig();
    updateRateDisplay();
    updateDerivedValues();
    if (rateConfig.mode === "auto") void refreshRate();
  });

  manualInput.addEventListener("change", () => {
    const v = Number(manualInput.value);
    if (Number.isFinite(v) && v > 0) {
      rateConfig.manual = v;
      saveRateConfig();
      updateRateDisplay();
      updateDerivedValues();
    }
  });
}

// ── Draggable splitter between the table and the share charts ────
// Keeps the table/charts at a user-chosen ratio (default 50/50) so the
// charts stay visible instead of being pushed off the bottom edge.
function initSplitter(): void {
  const view = document.getElementById("holdings-view");
  const splitter = document.getElementById("holdings-splitter");
  if (!view || !splitter) return;
  try {
    const saved = Number(dashboardStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(saved) && saved >= 20 && saved <= 80) {
      view.style.setProperty("--holdings-table-ratio", `${saved}%`);
    }
  } catch {
    /* no saved ratio -> default 50% */
  }
  splitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startPct = parseFloat(getComputedStyle(view).getPropertyValue("--holdings-table-ratio")) || 50;
    splitter.classList.add("dragging");
    const onMove = (ev: MouseEvent) => {
      const rect = view.getBoundingClientRect();
      if (rect.height <= 0) return;
      const next = ((startPct / 100) * rect.height + (ev.clientY - startY)) / rect.height * 100;
      const clamped = Math.min(80, Math.max(20, next));
      view.style.setProperty("--holdings-table-ratio", `${clamped}%`);
      try {
        dashboardStorage.setItem(SPLIT_KEY, String(clamped));
      } catch {
        /* storage unavailable -> keep ratio for this session */
      }
    };
    const onUp = () => {
      splitter.classList.remove("dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

// ── Public API for dashboard.ts ─────────────────────────────────
export function initHoldingsView(): void {
  initSplitter();
  tbody = document.getElementById("holdings-tbody");
  amountChart = document.getElementById("amount-bar-chart");
  pieChart = document.getElementById("asset-pie-chart");
  rateDisplay = document.getElementById("holdings-rate");

  const datalist = document.getElementById("holdings-symbol-list") as HTMLDataListElement | null;
  if (datalist) {
    for (const sym of Object.keys(CRYPTO_LOGO_EXT).sort()) {
      const opt = document.createElement("option");
      opt.value = sym;
      datalist.appendChild(opt);
    }
  }

  initCurrencyToggle();
  document.getElementById("holdings-add-btn")?.addEventListener("click", showAddForm);
  document.getElementById("new-confirm")?.addEventListener("click", confirmAdd);
  document.getElementById("new-cancel")?.addEventListener("click", hideAddForm);
  const dateInput = document.getElementById("new-date") as HTMLInputElement | null;
  if (dateInput) dateInput.value = today();

  renderHoldingsTable();
  updateCurrencyToggle();
  updateRateDisplay();
  initRateSettings();
  refreshHoldingsCount();

  void refreshRate();
  void pollPrices();
  window.setInterval(() => void pollPrices(), PRICE_REFRESH_MS);
  window.setInterval(() => void refreshRate(), RATE_REFRESH_MS);
}

/** Re-read holdings, rate and currency after IndexedDB hydration, then refresh. */
export function reloadHoldingsData(): void {
  holdings = loadHoldings();
  rateConfig = loadRateConfig();
  currency = loadCurrency();
  if (tbody) {
    renderHoldingsTable();
    updateCurrencyToggle();
    updateRateDisplay();
    refreshHoldingsCount();
  }
}

export function refreshHoldingsCount(): void {
  const el = document.getElementById("holdings-count");
  if (el) el.textContent = String(holdings.length);
}

export function setHoldingsViewActive(active: boolean): void {
  holdingsViewActive = active;
  // While hidden, poll results skip DOM writes; re-render on activation so the
  // table/charts reflect the latest prices and rate immediately.
  if (active) updateDerivedValues();
}

// Re-export for tests.
export { baseSymbolOf, computeRow, computeTotals, formatMoney, formatPrice, formatProfitPct, formatQuantity, profitClass };
export type { Currency, Holding, HoldingRow } from "./holdingsCore";