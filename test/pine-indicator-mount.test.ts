import { describe, expect, it, vi } from 'vitest';
import { PineIndicatorMount, type PineIndicatorHost } from '../playground/pineMount';
import type { IndicatorHandle } from '../src';

/** Fake host whose addIndicator returns a spy-able handle. */
function makeCell(id: string): { host: PineIndicatorHost; handle: { remove: ReturnType<typeof vi.fn> } } {
    const handle = { remove: vi.fn() };
    const host: PineIndicatorHost = {
        id,
        chart: {
            addIndicator: () => handle as unknown as IndicatorHandle,
        },
    };
    return { host, handle };
}

describe('PineIndicatorMount', () => {
    it('applies a script to every host and tracks the handles', () => {
        const mount = new PineIndicatorMount();
        const { host: a } = makeCell('cell-a');
        const { host: b } = makeCell('cell-b');

        const results = mount.apply([a, b], '// v5');

        expect(results).toHaveLength(2);
        expect(results.every((r) => r.ok)).toBe(true);
        expect(mount.mountedCount).toBe(2);
        expect(mount.has('cell-a')).toBe(true);
        expect(mount.has('cell-b')).toBe(true);
    });

    it('replaces the previous instance on re-apply instead of stacking duplicates', () => {
        const mount = new PineIndicatorMount();
        const { host: a, handle: ha } = makeCell('cell-a');
        const { host: b, handle: hb } = makeCell('cell-b');

        mount.apply([a, b], '// v1');
        mount.apply([a, b], '// v2');

        // Old instances were removed before the new ones mounted: still one live per cell.
        expect(ha.remove).toHaveBeenCalledTimes(1);
        expect(hb.remove).toHaveBeenCalledTimes(1);
        expect(mount.mountedCount).toBe(2);
    });

    it('clear removes every mounted instance and reports the count', () => {
        const mount = new PineIndicatorMount();
        const { host: a, handle: ha } = makeCell('cell-a');
        const { host: b, handle: hb } = makeCell('cell-b');
        mount.apply([a, b], '// v1');

        const removed = mount.clear();

        expect(removed).toBe(2);
        expect(ha.remove).toHaveBeenCalledTimes(1);
        expect(hb.remove).toHaveBeenCalledTimes(1);
        expect(mount.mountedCount).toBe(0);
        expect(mount.has('cell-a')).toBe(false);
    });

    it('keeps mounting the remaining cells when one addIndicator throws', () => {
        const mount = new PineIndicatorMount();
        const { host: a } = makeCell('cell-a');
        const badHost: PineIndicatorHost = {
            id: 'cell-bad',
            chart: {
                addIndicator: () => {
                    throw new Error('boom');
                },
            },
        };

        const results = mount.apply([a, badHost], '// v1');

        expect(results[0]).toMatchObject({ hostId: 'cell-a', ok: true });
        expect(results[1]).toMatchObject({ hostId: 'cell-bad', ok: false });
        expect(mount.mountedCount).toBe(1);
        expect(mount.has('cell-a')).toBe(true);
        expect(mount.has('cell-bad')).toBe(false);
    });

    it('drops a destroyed cell without removing the other handles', () => {
        const mount = new PineIndicatorMount();
        const { host: a, handle: ha } = makeCell('cell-a');
        const { host: b } = makeCell('cell-b');
        mount.apply([a, b], '// v1');

        mount.drop('cell-a');

        expect(mount.has('cell-a')).toBe(false);
        expect(mount.has('cell-b')).toBe(true);
        expect(ha.remove).not.toHaveBeenCalled(); // chart teardown owns the destroyed cell
    });
});