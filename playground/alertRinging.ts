// Playground module: per-alert ringing scheduler. A triggered alert repeats its
// sound on an interval until it is muted (explicit `stop`) or the ring duration
// elapses. Pure timer bookkeeping — the audio playback and toast UI live in
// dashboard.ts, which drives this via `play` / `onStop`.

export const DEFAULT_RING_INTERVAL_MS = 4_000;
export const DEFAULT_RING_DURATION_MS = 60_000;

export interface RingHandle {
    timer: ReturnType<typeof setInterval>;
    timeout: ReturnType<typeof setTimeout>;
}

export class RingScheduler {
    private readonly ringing = new Map<string, RingHandle>();

    constructor(
        private readonly play: () => void,
        private readonly intervalMs: number = DEFAULT_RING_INTERVAL_MS,
        private readonly durationMs: number = DEFAULT_RING_DURATION_MS,
        private readonly onStop?: (id: string) => void,
    ) {}

    /** Start ringing an alert: play now, then repeat until stopped or expired. */
    start(id: string): void {
        this.stop(id);
        this.play();
        const timer = setInterval(() => this.play(), this.intervalMs);
        const timeout = setTimeout(() => this.stop(id), this.durationMs);
        this.ringing.set(id, { timer, timeout });
    }

    /** Stop ringing an alert and fire `onStop` exactly once. */
    stop(id: string): void {
        const handle = this.ringing.get(id);
        if (!handle) return;
        this.ringing.delete(id);
        clearInterval(handle.timer);
        clearTimeout(handle.timeout);
        this.onStop?.(id);
    }

    /** Whether an alert is currently ringing. */
    isRinging(id: string): boolean {
        return this.ringing.has(id);
    }

    /** Stop every ringing alert. */
    stopAll(): void {
        for (const id of [...this.ringing.keys()]) this.stop(id);
    }
}