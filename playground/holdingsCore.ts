// Pure holdings math, formatting and types — no DOM / localStorage / network,
// so the whole module is unit-testable in Node.

export type Holding = {
  id: string;
  symbol: string; // Binance pair, e.g. "TRXUSDT"; "USDT" is the stablecoin
  buyDate: string; // "YYYY-MM-DD"
  quantity: number;
  buyPrice: number; // USDT per unit (base denomination)
  remark: string;
};

export type Currency = "USDT" | "RMB";

export type HoldingRow = {
  holding: Holding;
  currentPrice: number; // USDT per unit
  buyMarketValue: number; // USDT
  currentMarketValue: number; // USDT
  profit: number; // USDT
  profitPct: number; // percent, (current-buy)/buy*100
};

export type Totals = {
  buyMarketValue: number;
  currentMarketValue: number;
  profit: number;
  profitPct: number;
};

/** Strip the USDT quote suffix: "TRXUSDT" -> "TRX"; "USDT" stays "USDT".
 *  Perpetual-futures tickers carry a ".P" suffix ("BTCUSDT.P" -> "BTC"). */
export function baseSymbolOf(symbol: string): string {
  const s = symbol.toUpperCase();
  const base = s.endsWith(".P") ? s.slice(0, -2) : s;
  if (base !== "USDT" && base.endsWith("USDT")) return base.slice(0, -4);
  return base;
}

/** Compute one holding's derived figures from a live USDT price. */
export function computeRow(holding: Holding, currentPrice: number): HoldingRow {
  const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : 0;
  const buyMarketValue = holding.quantity * holding.buyPrice;
  const currentMarketValue = holding.quantity * price;
  const profit = currentMarketValue - buyMarketValue;
  const profitPct =
    holding.buyPrice > 0 ? ((price - holding.buyPrice) / holding.buyPrice) * 100 : 0;
  return { holding, currentPrice: price, buyMarketValue, currentMarketValue, profit, profitPct };
}

/** Aggregate totals across rows (USDT base). */
export function computeTotals(rows: HoldingRow[]): Totals {
  let buy = 0;
  let current = 0;
  for (const r of rows) {
    buy += r.buyMarketValue;
    current += r.currentMarketValue;
  }
  return {
    buyMarketValue: buy,
    currentMarketValue: current,
    profit: current - buy,
    profitPct: buy > 0 ? ((current - buy) / buy) * 100 : 0,
  };
}

/** Quantities keep 2 decimals, matching the reference table. */
export function formatQuantity(n: number): string {
  return n.toFixed(2);
}

/** Prices keep 4 decimals, matching the reference table. */
export function formatPrice(n: number): string {
  return n.toFixed(4);
}

/** Money keeps 2 decimals and carries its unit; RMB values are the USDT value times the rate. */
export function formatMoney(usdtValue: number, currency: Currency, rate: number): string {
  const value = currency === "RMB" ? usdtValue * rate : usdtValue;
  return `${value.toFixed(2)} ${currency === "RMB" ? "CNY" : "USDT"}`;
}

/** P/L percent: "12.34%" / "-5.67%" / "—" when not computable. */
export function formatProfitPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct.toFixed(2)}%`;
}

/** CSS class for the P/L cell: green up / red down. */
export function profitClass(pct: number): string {
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "";
}