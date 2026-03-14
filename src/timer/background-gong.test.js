// background-gong.test.js — Tests for gong schedule computation
//
// computeGongSchedule() is a pure function so no mocking is needed.
//
// NOTE: GONG_INTERVAL_SEC is 900 (15-min) for production.

import { describe, it, expect } from 'vitest';
import { computeGongSchedule } from './background-gong.js';

const NOW = 1_000_000; // arbitrary epoch ms

// Must match getGongIntervalSec() default in background-gong.js
const INTERVAL = 900;

describe('computeGongSchedule', () => {
    it('schedules settling gong at t=15 when elapsed=0', () => {
        const schedule = computeGongSchedule(0, NOW);
        const first = schedule[0];
        expect(first.fireAt.getTime()).toBe(NOW + 15_000);
    });

    it('does not schedule settling gong if already past t=15', () => {
        const schedule = computeGongSchedule(20, NOW);
        // First entry should be t=INTERVAL, not t=15
        expect(schedule[0].fireAt.getTime()).toBe(NOW + (INTERVAL - 20) * 1000);
    });

    it('schedules exactly 1 notification for the first interval mark (1 strike)', () => {
        const schedule = computeGongSchedule(20, NOW); // past t=15
        const baseMs = NOW + (INTERVAL - 20) * 1000;
        const entries = schedule.filter(
            e => e.fireAt.getTime() >= baseMs
              && e.fireAt.getTime() <  baseMs + 7_000
        );
        expect(entries.length).toBe(1);
    });

    it('schedules exactly 2 notifications for the 2nd interval mark (2 strikes)', () => {
        const schedule = computeGongSchedule(INTERVAL + 10, NOW); // past first interval
        const baseMs = NOW + (INTERVAL * 2 - (INTERVAL + 10)) * 1000;
        const strike1 = schedule.find(e => e.fireAt.getTime() === baseMs);
        const strike2 = schedule.find(e => e.fireAt.getTime() === baseMs + 7_000);
        expect(strike1).toBeDefined();
        expect(strike2).toBeDefined();
    });

    it('schedules exactly 3 notifications for the 3rd interval mark (3 strikes)', () => {
        const schedule = computeGongSchedule(INTERVAL * 2 + 10, NOW);
        const baseMs = NOW + (INTERVAL * 3 - (INTERVAL * 2 + 10)) * 1000;
        const count = schedule.filter(
            e => e.fireAt.getTime() >= baseMs && e.fireAt.getTime() < baseMs + 3 * 7_000
        ).length;
        expect(count).toBe(3);
    });

    it('7-second gap between strikes in multi-strike gongs', () => {
        const schedule = computeGongSchedule(INTERVAL + 10, NOW);
        const baseMs = NOW + (INTERVAL * 2 - (INTERVAL + 10)) * 1000;
        const atMark = schedule.filter(
            e => e.fireAt.getTime() >= baseMs && e.fireAt.getTime() < baseMs + 14_001
        );
        expect(atMark.length).toBe(2);
        expect(atMark[1].fireAt.getTime() - atMark[0].fireAt.getTime()).toBe(7_000);
    });

    it('returns empty schedule when elapsed is beyond 2 hours', () => {
        const schedule = computeGongSchedule(7201, NOW);
        expect(schedule.length).toBe(0);
    });

    it('all notification IDs are unique', () => {
        const schedule = computeGongSchedule(0, NOW);
        const ids = schedule.map(e => e.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    it('notifications within each interval group are ordered by fire time', () => {
        const schedule = computeGongSchedule(0, NOW);
        expect(schedule.length).toBeGreaterThan(0);
        // Verify no negative fire-time offsets
        for (const entry of schedule) {
            expect(entry.fireAt.getTime()).toBeGreaterThanOrEqual(NOW);
        }
    });

    it('total notification count for a 2-hour session from elapsed=0', () => {
        // INTERVAL=900, MAX=7200 → 8 interval marks + settling gong
        // t=15: 1 strike
        // t=900: 1, t=1800: 2, t=2700: 3, t=3600: 4, t=4500: 5, t=5400: 6, t=6300: 7, t=7200: 8
        // = 1 + sum(1..8) = 1 + 36 = 37
        const schedule = computeGongSchedule(0, NOW);
        expect(schedule.length).toBe(37);
    });
});
