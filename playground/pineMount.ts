// Playground module: tracks the single applied Pine indicator across grid cells.
// Apply is idempotent (clear-then-remount) so repeated「应用」never stacks duplicate
// instances; `clear()` is the shared teardown behind the「清空脚本」button.
// Design: docs/plans/pine-scripting.md
import type { IndicatorHandle } from "../src";

/** A grid cell that can mount a Pine script indicator via the public seam. */
export interface PineIndicatorHost {
    id: string;
    chart: { addIndicator(source: string): IndicatorHandle };
}

export type PineMountResult =
    | { hostId: string; ok: true; handle: IndicatorHandle }
    | { hostId: string; ok: false; error: unknown };

/** Bookkeeping for the one applied Pine script: per-cell live handles. */
export class PineIndicatorMount {
    private readonly handles = new Map<string, IndicatorHandle>();

    /** Number of grid cells currently holding the applied Pine indicator. */
    get mountedCount(): number {
        return this.handles.size;
    }

    /** Whether the given cell currently holds the applied Pine indicator. */
    has(hostId: string): boolean {
        return this.handles.has(hostId);
    }

    /** Snapshot of the live handles (for attaching ready/error listeners). */
    handlesOf(): ReadonlyMap<string, IndicatorHandle> {
        return this.handles;
    }

    /** Forget a host that is gone (its chart is torn down with the cell). */
    drop(hostId: string): void {
        this.handles.delete(hostId);
    }

    /** Remove the applied Pine indicator from every cell. Returns how many were removed. */
    clear(): number {
        const handles = [...this.handles.values()];
        this.handles.clear();
        let removed = 0;
        for (const handle of handles) {
            try {
                handle.remove();
                removed += 1;
            } catch {
                /* already torn down with its cell */
            }
        }
        return removed;
    }

    /** Mount `source` on every host, replacing any previously applied indicator. */
    apply(hosts: readonly PineIndicatorHost[], source: string): PineMountResult[] {
        this.clear();
        return hosts.map((host) => {
            try {
                const handle = host.chart.addIndicator(source);
                this.handles.set(host.id, handle);
                return { hostId: host.id, ok: true, handle };
            } catch (error) {
                return { hostId: host.id, ok: false, error };
            }
        });
    }
}