// background-gong.test.js — Tests for gong schedule computation
//
// computeGongSchedule() is a pure function so no mocking is needed.

import { describe, it, expect } from 'vitest';
import { computeGongSchedule } from './background-gong.js';

const NOW = 1_000_000; // arbitrary epoch ms

describe('computeGongSchedule', () => {
    it('schedules settling gong at t=15 when elapsed=0', () => {
        const schedule = computeGongSchedule(0, NOW);
        const first = schedule[0];
        expect(first.fireAt.getTime()).toBe(NOW + 15_000);
    });

    it('does not schedule settling gong if already past t=15', () => {
        const schedule = computeGongSchedule(20, NOW);
        // First entry should be t=900 (15-min mark), not t=15
        expect(schedule[0].fireAt.getTime()).toBe(NOW + (900 - 20) * 1000);
    });

    it('schedules exactly 1 notification for the 15-min mark (1 strike)', () => {
        const schedule = computeGongSchedule(20, NOW); // past t=15
        const t900Entries = schedule.filter(
            e => e.fireAt.getTime() >= NOW + (900 - 20) * 1000
              && e.fireAt.getTime() <  NOW + (900 - 20) * 1000 + 7_000
        );
        expect(t900Entries.length).toBe(1);
    });

    it('schedules exactly 2 notifications for the 30-min mark (2 strikes)', () => {
        const schedule = computeGongSchedule(910, NOW); // past t=15 and t=900
        const baseMs = NOW + (1800 - 910) * 1000;
        const strike1 = schedule.find(e => e.fireAt.getTime() === baseMs);
        const strike2 = schedule.find(e => e.fireAt.getTime() === baseMs + 7_000);
        expect(strike1).toBeDefined();
        expect(strike2).toBeDefined();
    });

    it('schedules exactly 3 notifications for the 45-min mark (3 strikes)', () => {
        const schedule = computeGongSchedule(1810, NOW); // past t=15, t=900, t=1800
        const baseMs = NOW + (2700 - 1810) * 1000;
        const count = schedule.filter(
            e => e.fireAt.getTime() >= baseMs && e.fireAt.getTime() < baseMs + 3 * 7_000
        ).length;
        expect(count).toBe(3);
    });

    it('7-second gap between strikes in multi-strike gongs', () => {
        const schedule = computeGongSchedule(910, NOW); // 30-min mark gives 2 strikes
        const baseMs = NOW + (1800 - 910) * 1000;
        const at1800 = schedule.filter(
            e => e.fireAt.getTime() >= baseMs && e.fireAt.getTime() < baseMs + 14_001
        );
        expect(at1800.length).toBe(2);
        expect(at1800[1].fireAt.getTime() - at1800[0].fireAt.getTime()).toBe(7_000);
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

    it('notifications are ordered by fire time', () => {
        const schedule = computeGongSchedule(0, NOW);
        for (let i = 1; i < schedule.length; i++) {
            expect(schedule[i].fireAt.getTime()).toBeGreaterThanOrEqual(
                schedule[i - 1].fireAt.getTime()
            );
        }
    });

    it('total notification count for a full 2-hour session from elapsed=0', () => {
        // t=15: 1 + t=900: 1 + t=1800: 2 + ... + t=7200: 8
        // = 1 + (1+2+3+4+5+6+7+8) = 1 + 36 = 37
        const schedule = computeGongSchedule(0, NOW);
        expect(schedule.length).toBe(37);
    });
});
