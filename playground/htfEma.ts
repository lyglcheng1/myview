// HTF EMA: a host-side native indicator that computes an exponential moving average on a
// HIGHER timeframe and paints it on the current chart, aligned by bar open time.
//
// Vela's built-in EMA only runs on the chart's own timeframe — there is no native API for
// cross-timeframe (HTF) indicators. This module implements the "business layer" route:
// it pulls HTF bars through the registered Binance provider, computes the EMA off-chart
// in plain JS, and emits the result as a regular line series through the public native-
// indicator seam (`registerNativeIndicator`). Each instance is one configurable line
// (length / HTF / color / width / visibility), so a cell can stack several independently
// toggleable HTF EMAs. The host dashboard drives instances through their IndicatorHandle.
import { registerNativeIndicator } from "../src/plugin";
import type {
  NativeIndicator,
  NativeIndicatorContext,
  NativeIndicatorDescriptor,
} from "../src/plugin";
import type { InputSchema, InputValue } from "../src/core/model/inputs";
import type { OHLCV } from "../src/core/model/ohlcv";
import { timeframeToMs } from "../src/data/timeframe";

/** Registered type of this indicator — `cell.chart.addNativeIndicator(HTF_EMA_TYPE, …)`. */
export const HTF_EMA_TYPE = "htf-ema";

/** Default amber line, matching the dashboard's accent. */
const DEFAULT_COLOR = "#f0b90b";

function num(v: Record<string, InputValue>, key: string, fallback: number): number {
  const x = v[key];
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

function str(v: Record<string, InputValue>, key: string, fallback: string): string {
  const x = v[key];
  return typeof x === "string" && x !== "" ? x : fallback;
}

/** Standard EMA with an SMA seed once `length` bars are available (TradingView-style). */
export function emaSeries(values: readonly number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (length < 1 || values.length < length) return out;
  const alpha = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) return out;
    sum += v;
  }
  let seed = sum / length;
  out[length - 1] = seed;
  for (let i = length; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue; // a gap keeps the last finite EMA off the chart
    seed = alpha * v + (1 - alpha) * seed;
    out[i] = seed;
  }
  return out;
}

/** Last index of `htfBars` whose open time is <= `time`, or -1 (binary search). */
export function lastBarAtOrBefore(htfBars: readonly OHLCV[], time: number): number {
  let lo = 0;
  let hi = htfBars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (htfBars[mid]!.time <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

interface HtfEmaCache {
  htf: string;
  length: number;
  bars: OHLCV[];
  values: number[];
}

class HtfEmaIndicator implements NativeIndicator {
  private ctx: NativeIndicatorContext | null = null;
  private inputs: Record<string, InputValue> = {};
  private cache: HtfEmaCache | null = null;
  private fetchSeq = 0;

  start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
    this.ctx = ctx;
    this.inputs = inputs;
    this.recompute();
  }

  onBars(): void {
    this.recompute();
  }

  onViewport(): void {
    // Viewport changes don't affect the EMA values.
  }

  setInputs(inputs: Record<string, InputValue>): void {
    this.inputs = inputs;
    this.recompute();
  }

  suspend(): void {
    this.fetchSeq++; // drop any in-flight fetch
    this.cache = null;
  }

  resume(): void {
    this.recompute();
  }

  stop(): void {
    this.fetchSeq++;
    this.ctx = null;
    this.cache = null;
  }

  private recompute(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const length = Math.max(1, Math.round(num(this.inputs, "length", 20)));
    const htf = str(this.inputs, "htf", "");
    const color = str(this.inputs, "color", DEFAULT_COLOR);
    const width = Math.min(5, Math.max(1, Math.round(num(this.inputs, "lineWidth", 2))));
    const enabled = this.inputs.enabled !== false;
    const bars = ctx.bars();

    // Same-timeframe EMA (the dashboard's main use): compute directly on the chart's own
    // bars — synchronous, no provider round-trip, no alignment needed.
    const sameTimeframe = htf === "" || htf === ctx.timeframe;
    if (sameTimeframe) {
      const values = emaSeries(bars.map((b) => b.close), length);
      const points = bars.map((bar, i) => {
        const v = values[i];
        return { time: bar.time, value: typeof v === "number" && Number.isFinite(v) ? v : null };
      });
      this.cache = null;
      ctx.emit({
        series: [
          {
            // `ctx.id` is the instance id — unique per stacked EMA, stable across re-runs.
            id: `htf-ema-${ctx.id}`,
            title: `EMA(${length})`,
            paneId: "",
            kind: "line",
            points,
            style: { color, width, lineStyle: "solid" },
            visible: enabled,
          },
        ],
      });
      return;
    }

    // Higher-timeframe EMA: pull HTF bars through the provider, compute off-chart, then
    // align each current bar to its containing HTF bar (last open time <= bar time).
    const seq = ++this.fetchSeq;
    const cached = this.cache;
    const cacheFresh =
      cached !== null &&
      cached.htf === htf &&
      cached.length === length &&
      cached.bars.length > 0 &&
      bars.length > 0 &&
      bars[bars.length - 1]!.time < cached.bars[cached.bars.length - 1]!.time + timeframeToMs(htf);

    const finish = (htfBars: OHLCV[]): void => {
      if (seq !== this.fetchSeq || this.ctx !== ctx) return;
      const values = emaSeries(htfBars.map((b) => b.close), length);
      this.cache = { htf, length, bars: htfBars, values };
      const points = bars.map((bar) => {
        const idx = lastBarAtOrBefore(htfBars, bar.time);
        const v = idx >= 0 ? (values[idx] ?? Number.NaN) : Number.NaN;
        return { time: bar.time, value: Number.isFinite(v) ? v : null };
      });
      ctx.emit({
        series: [
          {
            id: `htf-ema-${ctx.id}`,
            title: `EMA(${length}) ${htf}`,
            paneId: "",
            kind: "line",
            points,
            style: { color, width, lineStyle: "solid" },
            visible: enabled,
          },
        ],
      });
    };

    if (cacheFresh) {
      finish(cached.bars);
      return;
    }
    const provider = ctx.data.providerInstance("binance");
    if (!provider) return;
    const ticker = ctx.symbol.includes(":") ? ctx.symbol.split(":")[1]! : ctx.symbol;
    void provider
      .getBars(ticker, htf, { limit: 1000 })
      .then((htfBars) => finish(htfBars))
      .catch(() => {
        if (seq === this.fetchSeq) this.cache = null;
      });
  }
}

/** The registered descriptor: a multi-instance, legend-less overlay line. */
export const htfEmaDescriptor: NativeIndicatorDescriptor = {
  type: HTF_EMA_TYPE,
  title: "HTF EMA (跨周期均线)",
  shortTitle: "HTF EMA",
  paneHint: "price",
  overlay: true,
  multiInstance: true,
  legend: false,
  reactsToViewport: false,
  inputsSchema: (): InputSchema[] => [
    { key: "length", title: "EMA 周期", type: "int", defval: 20, min: 1, max: 5000, step: 1, tooltip: "EMA 的计算长度。" },
    { key: "htf", title: "跨周期（留空=同周期）", type: "string", defval: "", tooltip: "留空则在当前图表周期上计算；填写更高周期（如 60）则在该周期上计算后叠加。" },
    { key: "color", title: "线条颜色", type: "color", defval: DEFAULT_COLOR, tooltip: "EMA 线条的颜色。" },
    { key: "lineWidth", title: "线宽", type: "int", defval: 2, min: 1, max: 5, step: 1, tooltip: "EMA 线条的宽度（1–5）。" },
    { key: "enabled", title: "显示", type: "bool", defval: true, tooltip: "是否在图表上显示这条 EMA。" },
  ],
  defaultInputs: (): Record<string, InputValue> => ({
    length: 20,
    htf: "",
    color: DEFAULT_COLOR,
    lineWidth: 2,
    enabled: true,
  }),
  create: (): NativeIndicator => new HtfEmaIndicator(),
};

// Register at import time (before any chart is constructed) — idempotent.
registerNativeIndicator(htfEmaDescriptor);