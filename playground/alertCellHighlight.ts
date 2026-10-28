// Playground module: tracks how many ringing alerts reference each symbol, so the
// dashboard knows when to add/remove a cell's visual alert cue (border ring +
// corner badge). Pure counting — no DOM or timers, fully unit-testable.

export class RingSymbolCounter {
    private readonly counts = new Map<string, number>();

    /** Register one more ringing alert for a symbol. */
    add(symbol: string): void {
        this.counts.set(symbol, (this.counts.get(symbol) ?? 0) + 1);
    }

    /**
     * Remove one ringing alert for a symbol. Returns `true` when the last one is
     * gone (the caller should remove the visual cue), `false` if alerts remain.
     */
    remove(symbol: string): boolean {
        const n = (this.counts.get(symbol) ?? 1) - 1;
        if (n > 0) {
            this.counts.set(symbol, n);
            return false;
        }
        this.counts.delete(symbol);
        return true;
    }

    /** Whether any ringing alert references this symbol. */
    has(symbol: string): boolean {
        return this.counts.has(symbol);
    }
}