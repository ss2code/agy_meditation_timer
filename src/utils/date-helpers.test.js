import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    computeStreak,
    getLast30DaysData,
    formatDuration,
    isSameDay,
    getSessionReferenceDate,
} from './date-helpers.js';

// Helper: build a session whose end timestamp is N days ago
function sessionAt(daysAgo, durationSecs = 1800) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(8, 0, 0, 0);
    return { endTimestamp: d.toISOString(), duration: durationSecs };
}

describe('computeStreak', () => {
    it('returns 0 for no sessions', () => {
        expect(computeStreak([])).toBe(0);
    });

    it('returns 1 for a session only today', () => {
        expect(computeStreak([sessionAt(0)])).toBe(1);
    });

    it('counts consecutive days back from today', () => {
        const sessions = [sessionAt(0), sessionAt(1), sessionAt(2)];
        expect(computeStreak(sessions)).toBe(3);
    });

    it('breaks at the first missing day', () => {
        // Today, yesterday, but NOT 2 days ago
        const sessions = [sessionAt(0), sessionAt(1), sessionAt(3)];
        expect(computeStreak(sessions)).toBe(2);
    });

    it('returns 0 if only yesterday (no today)', () => {
        expect(computeStreak([sessionAt(1)])).toBe(0);
    });

    it('counts multiple sessions on the same day as 1', () => {
        const sessions = [sessionAt(0), sessionAt(0), sessionAt(1)];
        expect(computeStreak(sessions)).toBe(2);
    });
});

describe('getLast30DaysData', () => {
    it('returns 30 labels and 30 data points', () => {
        const { labels, data } = getLast30DaysData([]);
        expect(labels.length).toBe(30);
        expect(data.length).toBe(30);
    });

    it('all zeros for no sessions', () => {
        const { data } = getLast30DaysData([]);
        expect(data.every((d) => d === 0)).toBe(true);
    });

    it('counts minutes for sessions today', () => {
        const sessions = [sessionAt(0, 1800), sessionAt(0, 900)]; // 30m + 15m
        const { data } = getLast30DaysData(sessions, 30);
        expect(data[29]).toBe(45); // today is the last element
    });

    it('places session N days ago at the correct index', () => {
        const sessions = [sessionAt(5, 600)]; // 10 minutes, 5 days ago
        const { data } = getLast30DaysData(sessions, 30);
        expect(data[24]).toBe(10); // index 29-5 = 24
    });

    it('ignores sessions older than N days', () => {
        const sessions = [sessionAt(31, 3600)]; // outside 30-day window
        const { data } = getLast30DaysData(sessions, 30);
        expect(data.every((d) => d === 0)).toBe(true);
    });
});

describe('formatDuration', () => {
    it('formats seconds', () => { expect(formatDuration(45)).toBe('45s'); });
    it('formats minutes', () => { expect(formatDuration(90)).toBe('1m'); });
    it('formats hours and minutes', () => { expect(formatDuration(5400)).toBe('1h 30m'); });
    it('formats exact hours', () => { expect(formatDuration(7200)).toBe('2h'); });
});

describe('isSameDay', () => {
    it('returns true for same date', () => {
        expect(isSameDay(new Date('2026-03-06'), new Date('2026-03-06'))).toBe(true);
    });
    it('returns false for different dates', () => {
        expect(isSameDay(new Date('2026-03-06'), new Date('2026-03-07'))).toBe(false);
    });
});

describe('getSessionReferenceDate', () => {
    it('prefers startTimestamp over endTimestamp', () => {
        const d = getSessionReferenceDate({
            startTimestamp: '2026-04-09T10:00:00.000Z',
            endTimestamp: '2026-04-09T10:30:00.000Z',
            duration: 1800,
        });
        expect(d.toISOString()).toBe('2026-04-09T10:00:00.000Z');
    });

    it('falls back to endTimestamp when startTimestamp is missing', () => {
        const d = getSessionReferenceDate({
            endTimestamp: '2026-04-09T10:30:00.000Z',
            duration: 1800,
        });
        expect(d.toISOString()).toBe('2026-04-09T10:00:00.000Z');
    });
});
