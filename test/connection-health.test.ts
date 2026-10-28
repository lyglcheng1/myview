import { describe, expect, it, vi } from 'vitest';
import { ConnectionHealth, type ConnState, type ConnectionHealthCallbacks } from '../playground/connectionStatus';

function makeHealth(now: () => number, callbacks: ConnectionHealthCallbacks = {}) {
    return new ConnectionHealth({ slowLatencyMs: 3000, stallTimeoutMs: 10000, now }, callbacks);
}

describe('ConnectionHealth', () => {
    it('starts down and reaches ok on first open without firing recovery', () => {
        let now = 0;
        const recovered = vi.fn();
        const disconnected = vi.fn();
        const states: ConnState[] = [];
        const health = makeHealth(() => now, { onState: (s) => states.push(s), onDisconnected: disconnected, onRecovered: recovered });

        expect(health.state).toBe('down');
        health.handleOpen();
        expect(health.state).toBe('ok');
        health.handleMessage(500);
        expect(health.state).toBe('ok');
        expect(states).toEqual(['ok']);
        expect(recovered).not.toHaveBeenCalled();
        expect(disconnected).not.toHaveBeenCalled();
    });

    it('marks slow when latency exceeds the threshold and ok again when it drops', () => {
        let now = 0;
        const health = makeHealth(() => now);
        health.handleOpen();
        health.handleMessage(1000);
        expect(health.state).toBe('ok');
        health.handleMessage(4000);
        expect(health.state).toBe('slow');
        health.handleMessage(2000);
        expect(health.state).toBe('ok');
    });

    it('turns down when no message arrives within the stall window and fires disconnect once', () => {
        let now = 0;
        const disconnected = vi.fn();
        const recovered = vi.fn();
        const health = makeHealth(() => now, { onDisconnected: disconnected, onRecovered: recovered });
        health.handleOpen();
        now = 5000;
        health.tick();
        expect(health.state).toBe('ok');

        now = 15000; // 15s since the last message (> 10s stall timeout)
        health.tick();
        expect(health.state).toBe('down');
        expect(disconnected).toHaveBeenCalledTimes(1);
        expect(recovered).not.toHaveBeenCalled();

        now = 20000;
        health.tick();
        expect(disconnected).toHaveBeenCalledTimes(1); // still down → no re-fire
    });

    it('fires recovery once when reconnecting after a disconnect', () => {
        let now = 0;
        const disconnected = vi.fn();
        const recovered = vi.fn();
        const health = makeHealth(() => now, { onDisconnected: disconnected, onRecovered: recovered });
        health.handleOpen();
        now = 15000;
        health.tick();
        expect(health.state).toBe('down');
        expect(disconnected).toHaveBeenCalledTimes(1);

        now = 16000;
        health.handleOpen();
        health.handleMessage(500);
        expect(health.state).toBe('ok');
        expect(recovered).toHaveBeenCalledTimes(1);
        expect(disconnected).toHaveBeenCalledTimes(1);
    });

    it('keeps ok when tick runs before the stall timeout', () => {
        let now = 0;
        const disconnected = vi.fn();
        const health = makeHealth(() => now, { onDisconnected: disconnected });
        health.handleOpen();
        now = 9999;
        health.tick();
        expect(health.state).toBe('ok');
        expect(disconnected).not.toHaveBeenCalled();
    });

    it('handleClose while already down does not re-fire disconnect', () => {
        let now = 0;
        const disconnected = vi.fn();
        const health = makeHealth(() => now, { onDisconnected: disconnected });
        health.handleOpen();
        health.handleClose();
        expect(health.state).toBe('down');
        expect(disconnected).toHaveBeenCalledTimes(1);
        health.handleClose();
        expect(disconnected).toHaveBeenCalledTimes(1);
    });
});