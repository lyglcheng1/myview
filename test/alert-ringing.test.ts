import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    DEFAULT_RING_DURATION_MS,
    DEFAULT_RING_INTERVAL_MS,
    RingScheduler,
} from "../playground/alertRinging";

describe("RingScheduler", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("plays immediately on start and repeats at the interval", () => {
        const play = vi.fn();
        const s = new RingScheduler(play);
        s.start("a1");
        expect(play).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(DEFAULT_RING_INTERVAL_MS);
        expect(play).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(DEFAULT_RING_INTERVAL_MS);
        expect(play).toHaveBeenCalledTimes(3);
        expect(s.isRinging("a1")).toBe(true);
    });

    it("auto-stops after the ring duration", () => {
        const play = vi.fn();
        const onStop = vi.fn();
        const s = new RingScheduler(play, DEFAULT_RING_INTERVAL_MS, DEFAULT_RING_DURATION_MS, onStop);
        s.start("a1");
        vi.advanceTimersByTime(DEFAULT_RING_DURATION_MS);
        expect(s.isRinging("a1")).toBe(false);
        expect(onStop).toHaveBeenCalledWith("a1");
    });

    it("stop clears timers and fires onStop once", () => {
        const play = vi.fn();
        const onStop = vi.fn();
        const s = new RingScheduler(play, 1_000, 60_000, onStop);
        s.start("a1");
        s.stop("a1");
        expect(s.isRinging("a1")).toBe(false);
        expect(onStop).toHaveBeenCalledTimes(1);
        const count = play.mock.calls.length;
        vi.advanceTimersByTime(10_000);
        expect(play).toHaveBeenCalledTimes(count); // no further plays
    });

    it("restarting the same id resets timers without duplicates", () => {
        const play = vi.fn();
        const s = new RingScheduler(play, 1_000, 60_000);
        s.start("a1");
        s.start("a1");
        expect(play).toHaveBeenCalledTimes(2);
        const count = play.mock.calls.length;
        vi.advanceTimersByTime(1_000);
        expect(play).toHaveBeenCalledTimes(count + 1); // only one interval
    });

    it("stopAll stops every alert", () => {
        const play = vi.fn();
        const s = new RingScheduler(play, 1_000, 60_000);
        s.start("a1");
        s.start("a2");
        s.stopAll();
        expect(s.isRinging("a1")).toBe(false);
        expect(s.isRinging("a2")).toBe(false);
    });

    it("does nothing when stopping an unknown id", () => {
        const onStop = vi.fn();
        const s = new RingScheduler(() => {}, 1_000, 60_000, onStop);
        s.stop("missing");
        expect(onStop).not.toHaveBeenCalled();
    });
});