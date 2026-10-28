// Binance WebSocket connection-status monitor for the dashboard prototype.
// - ok:    messages arrive with acceptable latency  → green blinking dot
// - slow:  latest message latency exceeded the threshold → yellow dot
// - down:  socket closed/errored, or no message for `stallTimeoutMs` → red dot,
//          plus a one-shot disconnect alert (dialog + voice) and recovery notice.
//
// `ConnectionHealth` is a pure state machine (no WebSocket/DOM), so the transitions
// are unit-tested in `test/connection-health.test.ts`.
// Design: docs/plans/alerts.md
export type ConnState = "ok" | "slow" | "down";

export interface ConnectionHealthCallbacks {
    /** Every state change. */
    onState?: (state: ConnState) => void;
    /** Fired once when the connection enters `down` from a live state. */
    onDisconnected?: () => void;
    /** Fired once when the connection leaves `down` back to a live state. */
    onRecovered?: () => void;
}

export interface ConnectionHealthOptions {
    /** Latency (ms) above which the connection is considered slow. */
    slowLatencyMs: number;
    /** No message within this window (ms) marks the connection down. */
    stallTimeoutMs: number;
    /** Clock injection for tests. Defaults to `Date.now`. */
    now?: () => number;
}

/** Pure connection-health state machine, free of any WebSocket/DOM dependency. */
export class ConnectionHealth {
    readonly slowLatencyMs: number;
    readonly stallTimeoutMs: number;
    private readonly now: () => number;
    private readonly callbacks: ConnectionHealthCallbacks;
    private stateValue: ConnState = "down";
    private lastMessageAt = 0;
    private wasDisconnected = false;

    constructor(options: ConnectionHealthOptions, callbacks: ConnectionHealthCallbacks = {}) {
        this.slowLatencyMs = options.slowLatencyMs;
        this.stallTimeoutMs = options.stallTimeoutMs;
        this.now = options.now ?? (() => Date.now());
        this.callbacks = callbacks;
    }

    get state(): ConnState {
        return this.stateValue;
    }

    /** The socket opened — treat the connection as live until a message proves otherwise. */
    handleOpen(): void {
        this.lastMessageAt = this.now();
        this.transitionTo("ok");
    }

    /** A message arrived with the measured end-to-end latency (`ms`). */
    handleMessage(latencyMs: number): void {
        this.lastMessageAt = this.now();
        this.transitionTo(latencyMs > this.slowLatencyMs ? "slow" : "ok");
    }

    /** The socket closed or errored. */
    handleClose(): void {
        this.transitionTo("down");
    }

    /** Stall watchdog: mark down when no message arrived within the timeout. */
    tick(): void {
        if (this.stateValue !== "down" && this.now() - this.lastMessageAt > this.stallTimeoutMs) {
            this.transitionTo("down");
        }
    }

    private transitionTo(next: ConnState): void {
        if (next === this.stateValue) return;
        const prev = this.stateValue;
        this.stateValue = next;
        if (next === "down") {
            if (prev === "ok" || prev === "slow") {
                this.wasDisconnected = true;
                this.callbacks.onDisconnected?.();
            }
        } else if (this.wasDisconnected) {
            // Leaving `down` after a real disconnect is a recovery; the very first
            // connect (initial `down` → live) never fires `onRecovered`.
            this.wasDisconnected = false;
            this.callbacks.onRecovered?.();
        }
        this.callbacks.onState?.(next);
    }
}

export interface ConnectionMonitorOptions extends ConnectionHealthOptions {
    /** Full URL of the Binance status stream (e.g. `wss://stream.binance.com:9443/ws/!miniTicker@arr`). */
    url: string;
    /** WebSocket factory override for tests. */
    createWebSocket?: () => WebSocket;
    /** Stall-watchdog interval. Default 1000ms. */
    tickMs?: number;
    /** Reconnect delay after an unexpected close/error. Default 3000ms. */
    reconnectMs?: number;
}

/** WebSocket glue around {@link ConnectionHealth}: measures latency and reconnects. */
export class ConnectionMonitor {
    private readonly health: ConnectionHealth;
    private readonly url: string;
    private readonly createWebSocket: () => WebSocket;
    private readonly tickMs: number;
    private readonly reconnectMs: number;
    private ws: WebSocket | null = null;
    private stopped = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private tickTimer: ReturnType<typeof setInterval> | null = null;

    constructor(options: ConnectionMonitorOptions, callbacks: ConnectionHealthCallbacks = {}) {
        this.url = options.url;
        this.createWebSocket = options.createWebSocket ?? (() => new WebSocket(this.url));
        this.tickMs = options.tickMs ?? 1000;
        this.reconnectMs = options.reconnectMs ?? 3000;
        this.health = new ConnectionHealth(options, callbacks);
    }

    get state(): ConnState {
        return this.health.state;
    }

    start(): void {
        if (this.stopped) return;
        this.open();
        this.tickTimer = setInterval(() => this.health.tick(), this.tickMs);
    }

    stop(): void {
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.tickTimer) clearInterval(this.tickTimer);
        this.reconnectTimer = null;
        this.tickTimer = null;
        this.ws?.close();
        this.ws = null;
    }

    private open(): void {
        if (this.stopped) return;
        let ws: WebSocket;
        try {
            ws = this.createWebSocket();
        } catch {
            this.scheduleReconnect();
            return;
        }
        this.ws = ws;
        ws.onopen = () => this.health.handleOpen();
        ws.onmessage = (ev) => {
            // `!miniTicker@arr` events carry `E` (event time); latency = now - E.
            this.health.handleMessage(extractEventLatency(ev.data) ?? 0);
        };
        ws.onclose = () => {
            if (this.stopped) return;
            this.health.handleClose();
            this.scheduleReconnect();
        };
        ws.onerror = () => {
            try {
                ws.close();
            } catch {
                /* onclose handles the reconnect */
            }
        };
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.open();
        }, this.reconnectMs);
    }
}

/** Read the Binance event time `E` from a status message; null when unparseable. */
function extractEventLatency(data: unknown): number | null {
    try {
        const text = typeof data === "string" ? data : "";
        const parsed = JSON.parse(text) as unknown;
        // `!miniTicker@arr` → an array of per-symbol items, each with `E`.
        const eventTime = Array.isArray(parsed) ? (parsed[0] as { E?: unknown } | undefined)?.E : (parsed as { E?: unknown })?.E;
        if (typeof eventTime === "number" && Number.isFinite(eventTime)) {
            return Math.max(0, Date.now() - eventTime);
        }
    } catch {
        /* non-JSON control frame */
    }
    return null;
}