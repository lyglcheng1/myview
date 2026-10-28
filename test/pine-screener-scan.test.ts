import { describe, expect, it, vi } from "vitest";
import { runScan } from "../playground/screener/scan";
import type {
    EngineContextSnapshot,
    ExecutionHandlers,
    ExecutionRequest,
    ExecutionSession,
    OHLCV,
    PreparedScript,
} from "../src";
import type { ScanStock, ScreenerDataSource, ScreenerEngine } from "../playground/screener/types";

// Unit tests for the scan loop: whole-universe iteration, Pine headless
// execution (fake engine), signal matching, progress events, cancellation and
// error paths.

const TICKERS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

function makeBars(n = 40): OHLCV[] {
    return Array.from({ length: n }, (_, i) => ({
        time: i + 1,
        open: 10,
        high: 11,
        low: 9,
        close: 10,
        volume: 1,
    }));
}

function makeStocks(n: number): ScanStock[] {
    return Array.from({ length: n }, (_, i) => ({
        ticker: TICKERS[i]!,
        name: TICKERS[i]!.slice(0, -4),
    }));
}

/** Fake engine: prepares instantly, executes and reports `plots[signalPlot]`. */
function createFakeEngine(plotValues: Record<string, number>): { engine: ScreenerEngine; executed: string[] } {
    const executed: string[] = [];
    const engine: ScreenerEngine = {
        prepare: vi.fn(async () => ({ inputs: [] }) as unknown as PreparedScript),
        execute: vi.fn((req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession => {
            executed.push(req.market.symbol);
            const session: ExecutionSession = {
                getContext: async (): Promise<EngineContextSnapshot | null> => ({
                    language: "pine",
                    phase: "idle",
                    barIndex: req.bars.length - 1,
                    meta: { title: "test", overlay: true },
                    plots: {
                        signal: [{ time: 1, value: plotValues[req.market.symbol] ?? 0 }],
                        myplot: [{ time: 1, value: plotValues[req.market.symbol] ?? 0 }],
                    },
                    variables: {},
                    warnings: [],
                }),
                stop: () => {},
                update: () => {},
                setVisibleRange: () => {},
                notifyBars: () => {},
            };
            // Defer so `session` is assigned before onDone reads it.
            queueMicrotask(() => handlers.onDone?.());
            return session;
        }),
    };
    return { engine, executed };
}

function makeDataSource(stocks: ScanStock[], barsByTicker: Record<string, OHLCV[]>): ScreenerDataSource {
    return {
        listStocks: vi.fn(async () => stocks),
        getBars: vi.fn(async (s) => barsByTicker[s.ticker] ?? []),
        syncBars: vi.fn(async (s) => ({ bars: barsByTicker[s.ticker] ?? [], cached: true, updated: false })),
    };
}

describe("runScan", () => {
    it("scans every stock and returns only the matching ones", async () => {
        const stocks = makeStocks(3);
        const bars = makeBars();
        const { engine, executed } = createFakeEngine({ "ETHUSDT": 1 });
        const dataSource = makeDataSource(stocks, Object.fromEntries(stocks.map((s) => [s.ticker, bars])));

        const outcome = await runScan(engine, dataSource, {
            source: "// test",
            onProgress: () => {},
            shouldStop: () => false,
        });

        expect(outcome.phase).toBe("done");
        expect(executed).toHaveLength(3);
        expect(outcome.results).toHaveLength(1);
        const hit = outcome.results[0]!;
        expect(hit.ticker).toBe("ETHUSDT");
        expect(hit.name).toBe("ETH");
        expect(hit.price).toBe(10);
        expect(hit.changePct).toBe(0);
    });

    it("emits preparing, scanning and done progress in order", async () => {
        const stocks = makeStocks(2);
        const bars = makeBars();
        const { engine } = createFakeEngine({});
        const dataSource = makeDataSource(stocks, Object.fromEntries(stocks.map((s) => [s.ticker, bars])));
        const phases: string[] = [];
        let doneSnapshot: { total: number; done: number; matched: number } | null = null;

        await runScan(engine, dataSource, {
            source: "// test",
            onProgress: (p) => {
                phases.push(p.phase);
                if (p.phase === "done") doneSnapshot = { total: p.total, done: p.done, matched: p.matched };
            },
            shouldStop: () => false,
        });

        expect(phases[0]).toBe("preparing");
        expect(phases.filter((p) => p === "scanning").length).toBe(2);
        expect(phases[phases.length - 1]).toBe("done");
        expect(doneSnapshot).toEqual({ total: 2, done: 2, matched: 0 });
    });

    it("respects a custom signal plot name", async () => {
        const stocks = makeStocks(1);
        const bars = makeBars();
        const { engine } = createFakeEngine({ "BTCUSDT": 1 });
        const dataSource = makeDataSource(stocks, Object.fromEntries(stocks.map((s) => [s.ticker, bars])));

        const outcome = await runScan(engine, dataSource, {
            source: "// test",
            signalPlot: "myplot",
            onProgress: () => {},
            shouldStop: () => false,
        });

        expect(outcome.results).toHaveLength(1);
        expect(outcome.results[0]!.signal).toBe(1);
    });

    it("skips stocks with too few bars for a meaningful signal", async () => {
        const stocks = makeStocks(1);
        const shortBars = makeBars(5); // below MIN_BARS → skipped entirely
        const { engine, executed } = createFakeEngine({ "BTCUSDT": 1 });
        const dataSource = makeDataSource(stocks, { "BTCUSDT": shortBars });

        const outcome = await runScan(engine, dataSource, {
            source: "// test",
            onProgress: () => {},
            shouldStop: () => false,
        });

        expect(outcome.results).toHaveLength(0);
        expect(executed).toHaveLength(0);
    });

    it("cancels cooperatively and reports the cancelled phase", async () => {
        const stocks = makeStocks(5);
        const bars = makeBars();
        const { engine } = createFakeEngine({});
        const dataSource = makeDataSource(stocks, Object.fromEntries(stocks.map((s) => [s.ticker, bars])));
        let checks = 0;
        const phases: string[] = [];

        const outcome = await runScan(engine, dataSource, {
            source: "// test",
            onProgress: (p) => phases.push(p.phase),
            shouldStop: () => ++checks > 3,
        });

        expect(outcome.phase).toBe("cancelled");
        expect(phases[phases.length - 1]).toBe("cancelled");
        expect(outcome.results).toHaveLength(0);
    });

    it("reports a prepare failure as an error outcome", async () => {
        const engine: ScreenerEngine = {
            prepare: vi.fn(async () => {
                throw new Error("syntax error at line 3");
            }),
            execute: vi.fn(),
        };
        const stocks = makeStocks(1);
        const dataSource = makeDataSource(stocks, { "BTCUSDT": makeBars() });
        let errorMessage = "";

        const outcome = await runScan(engine, dataSource, {
            source: "// bad script",
            onProgress: (p) => {
                if (p.phase === "error") errorMessage = p.message ?? "";
            },
            shouldStop: () => false,
        });

        expect(outcome.phase).toBe("error");
        expect(outcome.error).toContain("syntax error");
        expect(errorMessage).toContain("syntax error");
    });

    it("reports a code-table failure as an error outcome", async () => {
        const { engine } = createFakeEngine({});
        const dataSource: ScreenerDataSource = {
            listStocks: vi.fn(async () => {
                throw new Error("network down");
            }),
            getBars: vi.fn(async () => []),
            syncBars: vi.fn(async () => ({ bars: [], cached: true, updated: false })),
        };

        const outcome = await runScan(engine, dataSource, {
            source: "// test",
            onProgress: () => {},
            shouldStop: () => false,
        });

        expect(outcome.phase).toBe("error");
        expect(outcome.error).toContain("network down");
    });

    it("keeps scanning when a single stock fails to load", async () => {
        const stocks = makeStocks(3);
        const bars = makeBars();
        const { engine } = createFakeEngine({});
        const dataSource: ScreenerDataSource = {
            listStocks: vi.fn(async () => stocks),
            getBars: vi.fn(async (s) => {
                if (s.ticker === "ETHUSDT") throw new Error("boom");
                return bars;
            }),
            syncBars: vi.fn(async () => ({ bars, cached: true, updated: false })),
        };

        const outcome = await runScan(engine, dataSource, {
            source: "// test",
            onProgress: () => {},
            shouldStop: () => false,
        });

        expect(outcome.phase).toBe("done");
        expect(outcome.results).toHaveLength(0);
    });
});