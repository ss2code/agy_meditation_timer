import { describe, expect, it } from 'vitest';
import {
    buildSessionSummary,
    buildHistorySummary,
    computeHeartRateDelta,
    formatHeartRateDelta,
} from './session-language.js';

const BASE_MS = new Date('2026-04-09T08:00:00Z').getTime();

function hrPoint(offsetSeconds, value) {
    return {
        timestamp: new Date(BASE_MS + offsetSeconds * 1000).toISOString(),
        value,
    };
}

describe('computeHeartRateDelta', () => {
    it('returns end minus start bpm from a heart-rate series', () => {
        const hr = [hrPoint(0, 78), hrPoint(60, 74), hrPoint(120, 70)];
        expect(computeHeartRateDelta(hr)).toBe(-8);
    });

    it('returns null when there is not enough data', () => {
        expect(computeHeartRateDelta([])).toBeNull();
        expect(computeHeartRateDelta([hrPoint(0, 70)])).toBeNull();
    });
});

describe('formatHeartRateDelta', () => {
    it('formats falling heart rate as an easing label', () => {
        expect(formatHeartRateDelta(-9)).toBe('Down 9 bpm');
    });

    it('formats rising heart rate as an elevated label', () => {
        expect(formatHeartRateDelta(4)).toBe('Up 4 bpm');
    });

    it('formats flat heart rate neutrally', () => {
        expect(formatHeartRateDelta(0)).toBe('Steady');
    });
});

describe('buildSessionSummary', () => {
    it('describes a session that settled and stayed down', () => {
        const summary = buildSessionSummary({
            hr: [hrPoint(0, 80), hrPoint(300, 72), hrPoint(900, 68)],
            insights: { settleTime: { seconds: 360 } },
        });

        expect(summary.deltaLabel).toBe('Down 12 bpm');
        expect(summary.description).toBe('Dropped early, then stayed steady.');
    });

    it('describes a session with no settle and little change', () => {
        const summary = buildSessionSummary({
            hr: [hrPoint(0, 72), hrPoint(600, 71), hrPoint(1200, 72)],
            insights: { settleTime: null },
        });

        expect(summary.deltaLabel).toBe('Steady');
        expect(summary.description).toBe('Little physiological change showed up.');
    });

    it('describes a session that remained elevated', () => {
        const summary = buildSessionSummary({
            hr: [hrPoint(0, 68), hrPoint(600, 72), hrPoint(1200, 74)],
            insights: { settleTime: null },
        });

        expect(summary.deltaLabel).toBe('Up 6 bpm');
        expect(summary.description).toBe('Heart rate remained elevated.');
    });
});

describe('buildHistorySummary', () => {
    it('prefers settle time when available', () => {
        const summary = buildHistorySummary({
            duration: 1800,
            insights: { settleTime: { seconds: 420 } },
        });

        expect(summary).toBe('Settled in 7m');
    });

    it('falls back to a neutral note when bio evidence is sparse', () => {
        const summary = buildHistorySummary({
            duration: 1800,
            insights: { settleTime: null },
        });

        expect(summary).toBe('Quiet record');
    });
});
