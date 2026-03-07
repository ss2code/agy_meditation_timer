// timer.test.js — Wall-clock timer accuracy tests
//
// Verifies the timer tracks real elapsed time via Date.now() rather than
// counting setInterval ticks. This catches the mobile-throttling bug where
// the OS freezes intervals when the screen is off.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to import fresh module state for each test
let timer;

beforeEach(async () => {
    vi.useFakeTimers();
    // Reset module state by re-importing
    vi.resetModules();
    timer = await import('./timer.js');
    // Stub gong so it doesn't need AudioContext
    timer.gong.init = vi.fn();
    timer.gong.play = vi.fn();
});

afterEach(() => {
    // Clean up any running timer
    if (timer.isRunning()) timer.finishTimer();
    vi.useRealTimers();
});

// Helper: advance wall clock by `ms` and fire one interval tick.
// advanceTimersByTime also moves the fake clock, so we offset accordingly.
function advanceWallClock(ms) {
    vi.setSystemTime(new Date(Date.now() + ms));
    vi.advanceTimersByTime(1000);
}

describe('wall-clock timer', () => {
    it('tracks elapsed time from Date.now(), not tick count', () => {
        timer.startTimer();

        // Advance wall clock by 120s (only 1 interval tick fires)
        advanceWallClock(120_000);

        // Timer should report wall-clock time, not tick count
        // advanceWallClock fires 1 tick which adds 1s to fake clock,
        // so total is 121s. We check >= 120 to verify wall-clock tracking.
        expect(timer.elapsedTime).toBeGreaterThanOrEqual(120);
        expect(timer.elapsedTime).toBeLessThanOrEqual(121);
    });

    it('shows correct time after screen-off scenario (many minutes, few ticks)', () => {
        timer.startTimer();

        // Simulate 40 minutes passing with only 1 tick firing
        advanceWallClock(40 * 60 * 1000);

        expect(timer.elapsedTime).toBeGreaterThanOrEqual(2400);
        expect(timer.elapsedTime).toBeLessThanOrEqual(2401);
    });

    it('saves correct duration on finish after throttled interval', () => {
        let savedSession = null;
        timer.onSessionSave((s) => { savedSession = s; });
        timer.startTimer();

        // 30 minutes wall clock, but only 1 tick fires
        advanceWallClock(30 * 60 * 1000);

        timer.finishTimer();

        expect(savedSession).not.toBeNull();
        expect(savedSession.duration).toBeGreaterThanOrEqual(1800);
        expect(savedSession.duration).toBeLessThanOrEqual(1801);
    });

    it('pause and resume preserves accumulated time', () => {
        timer.startTimer();

        // Run for 60 seconds
        advanceWallClock(60_000);
        timer.pauseTimer();
        const afterPause = timer.elapsedTime;
        expect(afterPause).toBeGreaterThanOrEqual(60);
        expect(afterPause).toBeLessThanOrEqual(61);

        // Wall clock advances 5 minutes while paused — should NOT count
        vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000));

        // Resume and run for another 30 seconds
        timer.startTimer();
        advanceWallClock(30_000);

        // Should be ~90s (60 + 30), NOT 60 + 300 + 30
        expect(timer.elapsedTime).toBeGreaterThanOrEqual(90);
        expect(timer.elapsedTime).toBeLessThanOrEqual(92);
    });

    it('handleVisibilityResume syncs elapsed time immediately', () => {
        let lastTick = 0;
        timer.onTick((t) => { lastTick = t; });
        timer.startTimer();

        // Simulate 10 minutes passing with no interval ticks (screen off)
        vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));

        // App comes back to foreground — no tick needed
        timer.handleVisibilityResume();

        expect(timer.elapsedTime).toBe(600);
        expect(lastTick).toBe(600);
    });

    it('handleVisibilityResume is no-op when paused', () => {
        timer.startTimer();

        advanceWallClock(30_000);
        timer.pauseTimer();
        const frozenTime = timer.elapsedTime;

        // Screen off, then back — should not change anything since paused
        vi.setSystemTime(new Date(Date.now() + 60_000));
        timer.handleVisibilityResume();
        expect(timer.elapsedTime).toBe(frozenTime);
    });

    it('fires settling gong at t=15 even after throttled interval', () => {
        timer.startTimer();

        // Jump to 20 seconds in one leap (simulates throttled ticks)
        advanceWallClock(20_000);

        expect(timer.gong.play).toHaveBeenCalledWith(1); // settling gong
    });

    it('fires 15-minute gong even if interval was frozen across boundary', () => {
        timer.startTimer();

        // Jump straight past 15-minute mark
        advanceWallClock(16 * 60 * 1000);

        // Should have fired both the t=15 settling gong and t=900 interval gong
        const calls = timer.gong.play.mock.calls.map(c => c[0]);
        expect(calls).toContain(1); // t=15 settling gong (1 strike)
        // t=900 also gets play(1) since 900/900 = 1 interval completed
        // Verify it was called at least twice (once for t=15, once for t=900)
        const oneStrikeCalls = calls.filter(c => c === 1);
        expect(oneStrikeCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('setElapsedTime (debug) resets wall-clock baseline', () => {
        timer.startTimer();

        // Run for 10 seconds
        advanceWallClock(10_000);
        const after10 = timer.elapsedTime;
        expect(after10).toBeGreaterThanOrEqual(10);

        // Debug jump to 895
        timer.setElapsedTime(895);
        expect(timer.elapsedTime).toBe(895);

        // 10 more seconds pass
        advanceWallClock(10_000);

        expect(timer.elapsedTime).toBeGreaterThanOrEqual(905);
        expect(timer.elapsedTime).toBeLessThanOrEqual(906);
    });

    it('does not save sessions shorter than 10 seconds', () => {
        let savedSession = null;
        timer.onSessionSave((s) => { savedSession = s; });
        timer.startTimer();

        advanceWallClock(5_000);

        timer.finishTimer();
        expect(savedSession).toBeNull();
    });

    it('multiple pause/resume cycles accumulate correctly', () => {
        timer.startTimer();

        // Segment 1: 120s
        advanceWallClock(120_000);
        timer.pauseTimer();
        const seg1 = timer.elapsedTime;

        // Paused for 10 minutes (should not count)
        vi.setSystemTime(new Date(Date.now() + 600_000));

        // Segment 2: 180s
        timer.startTimer();
        advanceWallClock(180_000);
        timer.pauseTimer();
        const seg2 = timer.elapsedTime;

        // Paused again for 5 minutes
        vi.setSystemTime(new Date(Date.now() + 300_000));

        // Segment 3: 60s
        timer.startTimer();
        advanceWallClock(60_000);

        // Total should be ~360s (120 + 180 + 60), paused time excluded
        expect(timer.elapsedTime).toBeGreaterThanOrEqual(360);
        expect(timer.elapsedTime).toBeLessThanOrEqual(363);
    });

    it('finishTimer resets all state for a fresh session', () => {
        timer.startTimer();
        advanceWallClock(30_000);
        timer.finishTimer();

        expect(timer.elapsedTime).toBe(0);
        expect(timer.sessionStartTimestamp).toBeNull();
        expect(timer.isRunning()).toBe(false);

        // Start a new session — should start from 0
        timer.startTimer();
        advanceWallClock(15_000);
        expect(timer.elapsedTime).toBeGreaterThanOrEqual(15);
        expect(timer.elapsedTime).toBeLessThanOrEqual(16);
    });
});
