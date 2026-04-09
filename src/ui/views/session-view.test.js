import { describe, expect, it } from 'vitest';
import { shouldShowWatchEvidenceCharts } from './session-view.js';

describe('shouldShowWatchEvidenceCharts', () => {
    it('returns true only for health connect sessions with HR samples', () => {
        const session = { telemetrySource: 'health_connect' };
        const telemetry = { hr: [{ timestamp: '2026-04-09T00:00:00.000Z', value: 72 }] };
        expect(shouldShowWatchEvidenceCharts(session, telemetry)).toBe(true);
    });

    it('returns false for mock telemetry sessions', () => {
        const session = { telemetrySource: 'mock' };
        const telemetry = { hr: [{ timestamp: '2026-04-09T00:00:00.000Z', value: 72 }] };
        expect(shouldShowWatchEvidenceCharts(session, telemetry)).toBe(false);
    });

    it('returns false when HR samples are missing', () => {
        const session = { telemetrySource: 'health_connect' };
        expect(shouldShowWatchEvidenceCharts(session, { hr: [] })).toBe(false);
        expect(shouldShowWatchEvidenceCharts(session, {})).toBe(false);
    });
});
