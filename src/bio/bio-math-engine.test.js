import { describe, it, expect } from 'vitest';
import {
    calculateSettleTime,
    computeRMSSD,
    extractRespirationFromHRV,
    extractRespirationFromHR,
    analyzeSkinTemperature,
    detectTorpor,
    classifySession,
    analyzeSession,
    computeEffectiveSampleRate,
} from './bio-math-engine.js';
import { generateMockTelemetry } from './mock-data.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_MS = new Date('2026-03-06T08:00:00Z').getTime();

/** Build a deterministic time-series with no random noise. */
function makeSeries(durationSecs, intervalSecs, valueFn) {
    const points = [];
    for (let t = 0; t <= durationSecs; t += intervalSecs) {
        points.push({
            timestamp: new Date(BASE_MS + t * 1000).toISOString(),
            value: parseFloat(valueFn(t).toFixed(4)),
        });
    }
    return points;
}

// ─── calculateSettleTime ─────────────────────────────────────────────────────

describe('calculateSettleTime', () => {
    it('finds settle time when HR declines and holds', () => {
        // HR drops from 75 → 58 over 600 s, then stays flat at 58
        const hr = makeSeries(2700, 5, (t) => t < 600 ? 75 - (t / 600) * 17 : 58);
        const result = calculateSettleTime(hr);
        expect(result).not.toBeNull();
        // HR enters 5% band of min (58) when it drops to 60.9 ≈ t=500s
        expect(result.seconds).toBeGreaterThanOrEqual(480);
        expect(result.seconds).toBeLessThan(620);
    });

    it('returns null when HR never settles (restless oscillation)', () => {
        // HR oscillates widely between 71 and 85; no 60 s window stays within 5% of min
        const hr = makeSeries(2700, 5, (t) => 78 + Math.sin(t * 0.1) * 7);
        expect(calculateSettleTime(hr)).toBeNull();
    });

    it('returns null for empty or single-point series', () => {
        expect(calculateSettleTime([])).toBeNull();
        expect(calculateSettleTime([{ timestamp: new Date().toISOString(), value: 70 }])).toBeNull();
    });

    it('ignores the first 30 s when computing min HR', () => {
        // Very low HR spike in first 30 s — if not excluded, it would widen the band
        // and might produce a false "settled" result
        const hr = makeSeries(300, 5, (t) => {
            if (t < 30) return 40;   // artifactual spike — should be ignored
            return t < 120 ? 80 - (t / 120) * 20 : 60;
        });
        const result = calculateSettleTime(hr);
        // With spike excluded: minHR = 60, band = [60, 63]. HR reaches 60 around t=120.
        expect(result).not.toBeNull();
        // HR enters band [60, 63] around t=102s; nearest 5s sample is t=105
        expect(result.seconds).toBeGreaterThanOrEqual(100);
    });
});

// ─── computeRMSSD ────────────────────────────────────────────────────────────

describe('computeRMSSD', () => {
    it('computes RMSSD for constant intervals (should be 0)', () => {
        expect(computeRMSSD([800, 800, 800, 800])).toBeCloseTo(0, 5);
    });

    it('computes RMSSD for known values', () => {
        // Differences: 100, 100, 100 → sqrt(10000) = 100
        const rmssd = computeRMSSD([800, 900, 800, 900]);
        expect(rmssd).toBeCloseTo(100, 1);
    });

    it('returns 0 for fewer than 2 intervals', () => {
        expect(computeRMSSD([])).toBe(0);
        expect(computeRMSSD([800])).toBe(0);
    });

    it('handles large arrays efficiently', () => {
        const arr = Array.from({ length: 2700 }, () => 800 + Math.random() * 50);
        const result = computeRMSSD(arr);
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThan(200); // sanity range
    });
});

// ─── extractRespirationFromHRV ────────────────────────────────────────────────

describe('extractRespirationFromHRV', () => {
    it('returns empty for null / empty input', () => {
        expect(extractRespirationFromHRV(null)).toEqual([]);
        expect(extractRespirationFromHRV([])).toEqual([]);
    });

    it('returns empty when series is shorter than one window', () => {
        const short = makeSeries(30, 1, (t) => 900 + Math.sin(t) * 50);
        expect(extractRespirationFromHRV(short, 60)).toEqual([]);
    });

    it('detects ~5 bpm for DEEP profile RSA (period = 12 s)', () => {
        // Pure sine: 5 complete cycles per 60 s window → 5 upward zero crossings
        const hrv = makeSeries(2700, 1, (t) => 950 + Math.sin((2 * Math.PI * t) / 12) * 80);
        const result = extractRespirationFromHRV(hrv, 60);
        expect(result.length).toBeGreaterThan(0);
        const avg = result.reduce((s, p) => s + p.breathsPerMinute, 0) / result.length;
        expect(avg).toBeGreaterThanOrEqual(4);
        expect(avg).toBeLessThanOrEqual(6);
    });

    it('detects ~3 bpm for SOMNOLENT profile RSA (period = 20 s)', () => {
        // Pure sine: 3 complete cycles per 60 s window → 3 upward zero crossings
        const hrv = makeSeries(2700, 1, (t) => 900 + Math.sin((2 * Math.PI * t) / 20) * 50);
        const result = extractRespirationFromHRV(hrv, 60);
        expect(result.length).toBeGreaterThan(0);
        const avg = result.reduce((s, p) => s + p.breathsPerMinute, 0) / result.length;
        expect(avg).toBeGreaterThanOrEqual(2);
        expect(avg).toBeLessThanOrEqual(4.5);
    });

    it('detects higher bpm for RESTLESS profile (high-freq HRV noise)', () => {
        // sin(t * 1.3): period ~4.8 s ≈ 12.5 bpm — well above 6 bpm threshold
        const hrv = makeSeries(2700, 1, (t) => 750 + Math.sin(t * 1.3) * 120);
        const result = extractRespirationFromHRV(hrv, 60);
        expect(result.length).toBeGreaterThan(0);
        const avg = result.reduce((s, p) => s + p.breathsPerMinute, 0) / result.length;
        expect(avg).toBeGreaterThan(6); // should NOT be flagged as breathless
    });

    it('returns readings spaced ~30 s apart', () => {
        const hrv = makeSeries(2700, 1, (t) => 900 + Math.sin((2 * Math.PI * t) / 12) * 80);
        const result = extractRespirationFromHRV(hrv, 60);
        if (result.length < 2) return;
        const dtMs = new Date(result[1].timestamp).getTime() - new Date(result[0].timestamp).getTime();
        expect(dtMs).toBeCloseTo(30_000, -2); // within ±100 ms
    });
});

// ─── analyzeSkinTemperature ───────────────────────────────────────────────────

describe('analyzeSkinTemperature', () => {
    it('returns null values for empty input', () => {
        const r = analyzeSkinTemperature([]);
        expect(r.start).toBeNull();
        expect(r.delta).toBeNull();
        expect(r.trend).toBe('flat');
    });

    it('detects rising trend (DEEP profile)', () => {
        // Rising: 33.0 → 34.5°C, delta = +1.5
        const temp = makeSeries(2700, 30, (t) => 33.0 + (t / 2700) * 1.5);
        const r = analyzeSkinTemperature(temp);
        expect(r.trend).toBe('rising');
        expect(r.delta).toBeGreaterThan(0.1);
        expect(r.start).toBeCloseTo(33.0, 1);
        expect(r.end).toBeCloseTo(34.5, 1);
        expect(r.frictionPeriods.length).toBe(0);
    });

    it('detects falling trend (RESTLESS profile)', () => {
        // Falling: 33.5 → 32.7°C, delta = -0.8
        const temp = makeSeries(2700, 30, (t) => 33.5 - (t / 2700) * 0.8);
        const r = analyzeSkinTemperature(temp);
        expect(r.trend).toBe('falling');
        expect(r.delta).toBeLessThan(-0.1);
    });

    it('detects flat trend', () => {
        const temp = makeSeries(600, 30, () => 33.5);
        const r = analyzeSkinTemperature(temp);
        expect(r.trend).toBe('flat');
        expect(r.delta).toBeCloseTo(0, 2);
    });

    it('identifies friction periods for steep sustained decline', () => {
        // −0.06°C per 30 s step — clearly below the −0.02 threshold
        const temp = makeSeries(2700, 30, (t) => 34.0 - t * 0.002);
        const r = analyzeSkinTemperature(temp);
        expect(r.frictionPeriods.length).toBeGreaterThan(0);
        expect(r.frictionPeriods[0]).toHaveProperty('start');
        expect(r.frictionPeriods[0]).toHaveProperty('end');
    });

    it('has no friction periods for steady rise', () => {
        const temp = makeSeries(2700, 30, (t) => 33.0 + t * 0.002);
        const r = analyzeSkinTemperature(temp);
        expect(r.frictionPeriods.length).toBe(0);
    });

    it('does not produce friction periods shorter than 2 minutes', () => {
        // A single-step dip: just one interval below threshold, then recovery
        const BASE_TEMP = 33.5;
        const temp = [
            { timestamp: new Date(BASE_MS).toISOString(),           value: BASE_TEMP },
            { timestamp: new Date(BASE_MS + 30_000).toISOString(),  value: BASE_TEMP - 0.1 }, // dip
            { timestamp: new Date(BASE_MS + 60_000).toISOString(),  value: BASE_TEMP },       // recovery
        ];
        const r = analyzeSkinTemperature(temp);
        // One step = 30 s < 120 s minimum → should not be flagged
        expect(r.frictionPeriods.length).toBe(0);
    });
});

// ─── detectTorpor ─────────────────────────────────────────────────────────────

describe('detectTorpor', () => {
    it('returns no torpor for empty inputs', () => {
        expect(detectTorpor([], [])).toEqual({ torpidFlag: false, periods: [] });
        expect(detectTorpor(null, null)).toEqual({ torpidFlag: false, periods: [] });
    });

    it('flags torpor when breathing < 4 bpm AND SpO2 drops > 3%', () => {
        const respiration = [
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), breathsPerMinute: 2.5 },
            { timestamp: new Date(BASE_MS + 1830_000).toISOString(), breathsPerMinute: 2.5 },
        ];
        const spo2 = [
            { timestamp: new Date(BASE_MS).toISOString(),            value: 97.5 }, // baseline
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), value: 93.5 }, // drop of 4%
        ];
        const r = detectTorpor(respiration, spo2);
        expect(r.torpidFlag).toBe(true);
        expect(r.periods.length).toBeGreaterThan(0);
    });

    it('flags torpor when SpO2 falls below 94% absolute threshold', () => {
        const respiration = [
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), breathsPerMinute: 3.0 },
        ];
        const spo2 = [
            { timestamp: new Date(BASE_MS).toISOString(),            value: 96 }, // baseline (< 97 but within threshold)
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), value: 92 }, // absolute < 94
        ];
        const r = detectTorpor(respiration, spo2);
        expect(r.torpidFlag).toBe(true);
    });

    it('does NOT flag torpor when breathing is slow but SpO2 is stable', () => {
        const respiration = [
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), breathsPerMinute: 2.5 },
        ];
        const spo2 = [
            { timestamp: new Date(BASE_MS).toISOString(),            value: 97.5 },
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), value: 97.0 }, // only 0.5% drop
        ];
        expect(detectTorpor(respiration, spo2).torpidFlag).toBe(false);
    });

    it('does NOT flag torpor when SpO2 drops but breathing is normal', () => {
        const respiration = [
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), breathsPerMinute: 5.0 }, // ≥ 4 bpm
        ];
        const spo2 = [
            { timestamp: new Date(BASE_MS).toISOString(),            value: 97.5 },
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), value: 92.0 },
        ];
        expect(detectTorpor(respiration, spo2).torpidFlag).toBe(false);
    });

    it('skips breathless period if no concurrent SpO2 within 60 s', () => {
        const respiration = [
            { timestamp: new Date(BASE_MS + 1800_000).toISOString(), breathsPerMinute: 2.5 },
        ];
        const spo2 = [
            // Only a reading far from the breathless window
            { timestamp: new Date(BASE_MS).toISOString(), value: 92.0 },
        ];
        // 1800 s vs 0 s → diff = 1800 s > 60 s → no concurrent data → no torpor
        expect(detectTorpor(respiration, spo2).torpidFlag).toBe(false);
    });
});

// ─── classifySession ──────────────────────────────────────────────────────────

describe('classifySession', () => {
    it('returns restless for null insights', () => {
        expect(classifySession(null)).toBe('restless');
    });

    it('classifies somnolent when torpidFlag is true (top priority)', () => {
        const insights = {
            spo2: { torpidFlag: true },
            settleTime: { seconds: 60 },
            respirationRate: { breathlessPeriodsCount: 5 },
            skinTemp: { trend: 'rising' },
        };
        expect(classifySession(insights)).toBe('somnolent');
    });

    it('classifies deep_absorption with breathless periods + rising temp', () => {
        const insights = {
            spo2: { torpidFlag: false },
            settleTime: { seconds: 200 },
            respirationRate: { breathlessPeriodsCount: 3 },
            skinTemp: { trend: 'rising' },
        };
        expect(classifySession(insights)).toBe('deep_absorption');
    });

    it('classifies absorbed: settle < 5 min, no breathless, any temp', () => {
        const insights = {
            spo2: { torpidFlag: false },
            settleTime: { seconds: 180 },
            respirationRate: { breathlessPeriodsCount: 0 },
            skinTemp: { trend: 'flat' },
        };
        expect(classifySession(insights)).toBe('absorbed');
    });

    it('classifies settling: settle exists but >= 5 min', () => {
        const insights = {
            spo2: { torpidFlag: false },
            settleTime: { seconds: 600 },
            respirationRate: { breathlessPeriodsCount: 0 },
            skinTemp: { trend: 'flat' },
        };
        expect(classifySession(insights)).toBe('settling');
    });

    it('classifies restless: no settle time found', () => {
        const insights = {
            spo2: { torpidFlag: false },
            settleTime: null,
            respirationRate: { breathlessPeriodsCount: 0 },
            skinTemp: { trend: 'falling' },
        };
        expect(classifySession(insights)).toBe('restless');
    });

    it('deep_absorption requires BOTH breathless AND rising (not just one)', () => {
        // Breathless but flat temp → should fall through to absorbed/settling
        const insights = {
            spo2: { torpidFlag: false },
            settleTime: { seconds: 200 },
            respirationRate: { breathlessPeriodsCount: 3 },
            skinTemp: { trend: 'flat' },
        };
        expect(classifySession(insights)).toBe('absorbed'); // not deep_absorption
    });
});

// ─── extractRespirationFromHR ─────────────────────────────────────────────────

describe('extractRespirationFromHR', () => {
    it('returns empty for null / empty input', () => {
        expect(extractRespirationFromHR(null)).toEqual([]);
        expect(extractRespirationFromHR([])).toEqual([]);
    });

    it('returns empty when series has fewer than 10 points', () => {
        // 30 s at 5 s intervals = 7 points
        const short = makeSeries(30, 5, (t) => 65 + Math.sin(t / 2) * 3);
        expect(extractRespirationFromHR(short, 60)).toEqual([]);
    });

    it('detects ~5 bpm for HR with RSA wave at period = 12 s', () => {
        // HR oscillates at 5 bpm — same frequency as DEEP profile HRV RSA
        const hr = makeSeries(2700, 5, (t) => 65 + Math.sin((2 * Math.PI * t) / 12) * 5);
        const result = extractRespirationFromHR(hr, 60);
        expect(result.length).toBeGreaterThan(0);
        const avg = result.reduce((s, p) => s + p.breathsPerMinute, 0) / result.length;
        expect(avg).toBeGreaterThanOrEqual(4);
        expect(avg).toBeLessThanOrEqual(6);
    });

    it('detects ~3 bpm for HR with slow RSA (period = 20 s)', () => {
        const hr = makeSeries(2700, 5, (t) => 65 + Math.sin((2 * Math.PI * t) / 20) * 5);
        const result = extractRespirationFromHR(hr, 60);
        expect(result.length).toBeGreaterThan(0);
        const avg = result.reduce((s, p) => s + p.breathsPerMinute, 0) / result.length;
        expect(avg).toBeGreaterThanOrEqual(2);
        expect(avg).toBeLessThanOrEqual(4.5);
    });

    it('returns readings spaced ~30 s apart', () => {
        const hr = makeSeries(2700, 5, (t) => 65 + Math.sin((2 * Math.PI * t) / 12) * 5);
        const result = extractRespirationFromHR(hr, 60);
        if (result.length < 2) return;
        const dtMs = new Date(result[1].timestamp).getTime() - new Date(result[0].timestamp).getTime();
        expect(dtMs).toBeCloseTo(30_000, -2);
    });
});

// ─── analyzeSession (integration) ────────────────────────────────────────────

describe('analyzeSession integration', () => {
    it('classifies DEEP profile as deep_absorption', () => {
        const telemetry = {
            // HR: smooth decline 75→58 by t=600, flat thereafter
            hr:   makeSeries(2700, 5,  (t) => t < 600 ? 75 - (t / 600) * 17 : 58),
            // HRV: pure 5 bpm RSA (period 12 s) — breathless < 6 bpm
            hrv:  makeSeries(2700, 1,  (t) => 950 + Math.sin((2 * Math.PI * t) / 12) * 80),
            // Temp: steady rise 33.0 → 34.5°C
            temp: makeSeries(2700, 30, (t) => 33.0 + (t / 2700) * 1.5),
            // SpO2: stable ~97.5%
            spo2: makeSeries(2700, 60, () => 97.5),
        };
        const insights = analyzeSession(telemetry);
        expect(insights.sessionQuality).toBe('deep_absorption');
        expect(insights.settleTime).not.toBeNull();
        expect(insights.settleTime.seconds).toBeGreaterThanOrEqual(480);
        expect(insights.skinTemp.trend).toBe('rising');
        expect(insights.respirationRate.breathlessPeriodsCount).toBeGreaterThan(0);
        expect(insights.spo2.torpidFlag).toBe(false);
    });

    it('classifies SOMNOLENT profile as somnolent', () => {
        const telemetry = {
            hr:   makeSeries(2700, 5,  (t) => 70 - (t / 2700) * 15),
            // HRV: pure 3 bpm RSA (period 20 s)
            hrv:  makeSeries(2700, 1,  (t) => 900 + Math.sin((2 * Math.PI * t) / 20) * 50),
            temp: makeSeries(2700, 30, (t) => 33.5 + (t / 2700) * 0.4),
            // SpO2: stable first half, drops to 93% in second half
            spo2: makeSeries(2700, 30, (t) =>
                t < 1350 ? 97 : 97 - ((t - 1350) / 1350) * 4
            ),
        };
        const insights = analyzeSession(telemetry);
        expect(insights.sessionQuality).toBe('somnolent');
        expect(insights.spo2.torpidFlag).toBe(true);
    });

    it('classifies RESTLESS profile as restless', () => {
        const telemetry = {
            // HR: wide oscillation, never settles
            hr:   makeSeries(2700, 5,  (t) => 78 + Math.sin(t * 0.1) * 7),
            // HRV: high-freq noise ≈ 12 bpm RSA — above breathless threshold
            hrv:  makeSeries(2700, 1,  (t) => 750 + Math.sin(t * 1.3) * 120),
            // Temp: gradual decline
            temp: makeSeries(2700, 30, (t) => 33.2 - (t / 2700) * 0.3),
            spo2: makeSeries(2700, 60, () => 97),
        };
        const insights = analyzeSession(telemetry);
        expect(insights.sessionQuality).toBe('restless');
        expect(insights.settleTime).toBeNull();
    });

    it('handles empty telemetry gracefully', () => {
        const insights = analyzeSession({ hr: [], hrv: [], temp: [], spo2: [] });
        expect(insights.sessionQuality).toBe('restless');
        expect(insights.avgHR).toBeNull();
        expect(insights.avgHRV).toBeNull();
        expect(insights.spo2.torpidFlag).toBe(false);
    });

    it('falls back to extractRespirationFromHR when hrv is absent (Health Connect path)', () => {
        // Only HR data — no HRV. Should still compute respiration via HR RSA.
        const hr = makeSeries(2700, 5, (t) => 65 + Math.sin((2 * Math.PI * t) / 12) * 5);
        const insights = analyzeSession({ hr, hrv: [], temp: [], spo2: [] });
        expect(insights.respirationRate.average).toBeGreaterThan(0);
    });

    it('uses resp field directly when provided (Health Connect respiratory rate)', () => {
        // resp contains per-window respiratory rate already computed by HC
        const hr   = makeSeries(2700, 5,  (t) => 65 + Math.sin(t * 0.1) * 3);
        const resp = makeSeries(2700, 60, () => 5.5);
        const insights = analyzeSession({ hr, hrv: [], temp: [], spo2: [], resp });
        expect(insights.respirationRate.average).toBeCloseTo(5.5, 1);
    });

    it('includes torpidPeriods in spo2 insights', () => {
        const telemetry = {
            hr:   makeSeries(2700, 5,  (t) => 70 - (t / 2700) * 15),
            hrv:  makeSeries(2700, 1,  (t) => 900 + Math.sin((2 * Math.PI * t) / 20) * 50),
            temp: makeSeries(2700, 30, (t) => 33.5 + (t / 2700) * 0.4),
            spo2: makeSeries(2700, 30, (t) =>
                t < 1350 ? 97 : 97 - ((t - 1350) / 1350) * 4
            ),
        };
        const insights = analyzeSession(telemetry);
        expect(Array.isArray(insights.spo2.torpidPeriods)).toBe(true);
        if (insights.spo2.torpidFlag) {
            expect(insights.spo2.torpidPeriods.length).toBeGreaterThan(0);
        }
    });
});

// ─── RSA Sample Density Guard ────────────────────────────────────────────────

describe('RSA sample density guard', () => {
    it('returns empty for HR at 30s intervals (0.033 Hz < 0.1 Hz threshold)', () => {
        // 30s interval = 0.033 Hz — below Nyquist guard
        const hr = makeSeries(2700, 30, (t) => 65 + Math.sin((2 * Math.PI * t) / 12) * 5);
        const result = extractRespirationFromHR(hr, 60);
        expect(result).toEqual([]);
    });

    it('returns results for HR at 5s intervals (0.2 Hz >= 0.1 Hz threshold)', () => {
        // 5s interval = 0.2 Hz — above Nyquist guard
        const hr = makeSeries(2700, 5, (t) => 65 + Math.sin((2 * Math.PI * t) / 12) * 5);
        const result = extractRespirationFromHR(hr, 60);
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns results for HRV at 1s intervals (existing behavior)', () => {
        const hrv = makeSeries(2700, 1, (t) => 950 + Math.sin((2 * Math.PI * t) / 12) * 80);
        const result = extractRespirationFromHRV(hrv, 60);
        expect(result.length).toBeGreaterThan(0);
    });
});

// ─── computeEffectiveSampleRate ──────────────────────────────────────────────

describe('computeEffectiveSampleRate', () => {
    it('returns 0 for empty or single-point series', () => {
        expect(computeEffectiveSampleRate([])).toBe(0);
        expect(computeEffectiveSampleRate([{ timestamp: new Date().toISOString() }])).toBe(0);
    });

    it('computes correct rate for 5s intervals', () => {
        const series = makeSeries(100, 5, () => 0);
        const rate = computeEffectiveSampleRate(series);
        expect(rate).toBeCloseTo(0.2, 2);
    });

    it('computes correct rate for 30s intervals', () => {
        const series = makeSeries(300, 30, () => 0);
        const rate = computeEffectiveSampleRate(series);
        expect(rate).toBeCloseTo(0.033, 2);
    });
});

// ─── analyzeSession metadata ─────────────────────────────────────────────────

describe('analyzeSession metadata', () => {
    it('includes respirationRate.source and confidence', () => {
        const telemetry = {
            hr:   makeSeries(2700, 5,  (t) => 65 + Math.sin((2 * Math.PI * t) / 12) * 5),
            hrv:  [],
            temp: [],
            spo2: [],
        };
        const insights = analyzeSession(telemetry);
        expect(insights.respirationRate.source).toBe('rsa_hr');
        expect(insights.respirationRate.confidence).toBe('low');
    });

    it('sets source to health_connect_direct when resp provided', () => {
        const hr   = makeSeries(2700, 5, (t) => 65);
        const resp = makeSeries(2700, 60, () => 5.5);
        const insights = analyzeSession({ hr, hrv: [], temp: [], spo2: [], resp });
        expect(insights.respirationRate.source).toBe('health_connect_direct');
        expect(insights.respirationRate.confidence).toBe('high');
    });

    it('sets source to rsa_hrv when dense HRV data available', () => {
        const telemetry = {
            hr:   makeSeries(2700, 5,  (t) => 65),
            hrv:  makeSeries(2700, 1,  (t) => 950 + Math.sin((2 * Math.PI * t) / 12) * 80),
            temp: [],
            spo2: [],
        };
        const insights = analyzeSession(telemetry);
        expect(insights.respirationRate.source).toBe('rsa_hrv');
        expect(insights.respirationRate.confidence).toBe('medium');
    });

    it('includes telemetryDiagnostics with sample counts and rates', () => {
        const telemetry = {
            hr:   makeSeries(2700, 5,  (t) => 65),
            hrv:  makeSeries(2700, 1,  (t) => 950),
            temp: makeSeries(2700, 30, () => 33),
            spo2: makeSeries(2700, 60, () => 97),
        };
        const insights = analyzeSession(telemetry);
        expect(insights.telemetryDiagnostics).toBeDefined();
        expect(insights.telemetryDiagnostics.sampleCounts.hr).toBe(telemetry.hr.length);
        expect(insights.telemetryDiagnostics.sampleCounts.hrv).toBe(telemetry.hrv.length);
        expect(insights.telemetryDiagnostics.effectiveRates.hr).toBeCloseTo(0.2, 2);
        expect(insights.telemetryDiagnostics.effectiveRates.hrv).toBeCloseTo(1.0, 1);
    });

    it('sets insufficient_data when sparse HR cannot produce RSA', () => {
        // 30s intervals = too sparse for RSA
        const telemetry = {
            hr:   makeSeries(2700, 30, (t) => 65 + Math.sin((2 * Math.PI * t) / 12) * 5),
            hrv:  [],
            temp: [],
            spo2: [],
        };
        const insights = analyzeSession(telemetry);
        expect(insights.respirationRate.source).toBe('insufficient_data');
        expect(insights.respirationRate.confidence).toBe('none');
    });
});

// ─── generateMockTelemetry (duration-aware mock data) ────────────────────────

describe('generateMockTelemetry', () => {
    it('generates telemetry spanning the requested duration', () => {
        const startMs = BASE_MS;
        const durationSecs = 120; // 2 minutes
        const tel = generateMockTelemetry(startMs, durationSecs);

        const hrStart = new Date(tel.hr[0].timestamp).getTime();
        const hrEnd   = new Date(tel.hr[tel.hr.length - 1].timestamp).getTime();
        const spanSecs = (hrEnd - hrStart) / 1000;

        expect(spanSecs).toBeLessThanOrEqual(durationSecs);
        expect(spanSecs).toBeGreaterThanOrEqual(durationSecs - 5); // within one HR interval
    });

    it('does NOT produce 45-min data for a short session', () => {
        const tel = generateMockTelemetry(BASE_MS, 70); // 70 seconds
        const hrEnd = new Date(tel.hr[tel.hr.length - 1].timestamp).getTime();
        const spanSecs = (hrEnd - BASE_MS) / 1000;
        expect(spanSecs).toBeLessThanOrEqual(70);
    });

    it('produces correct number of HR samples (every 5s)', () => {
        const tel = generateMockTelemetry(BASE_MS, 120);
        // 120s / 5s = 24 intervals + 1 start point = 25
        expect(tel.hr.length).toBe(25);
    });

    it('produces minimal temp/spo2 for very short sessions', () => {
        const tel = generateMockTelemetry(BASE_MS, 20); // 20 seconds
        // temp every 30s: only t=0 → 1 point
        expect(tel.temp.length).toBe(1);
        // spo2 every 60s: only t=0 → 1 point
        expect(tel.spo2.length).toBe(1);
    });

    it('supports all three profile names', () => {
        for (const name of ['deep', 'restless', 'somnolent']) {
            const tel = generateMockTelemetry(BASE_MS, 300, name);
            expect(tel.hr.length).toBeGreaterThan(0);
            expect(tel.source).toBe('mock');
        }
    });

    it('defaults to deep profile for unknown name', () => {
        const tel = generateMockTelemetry(BASE_MS, 300, 'unknown');
        expect(tel.hr.length).toBeGreaterThan(0);
    });

    it('produces analyzable data for a 2-min session', () => {
        const tel = generateMockTelemetry(BASE_MS, 120);
        const insights = analyzeSession(tel);
        expect(insights.avgHR).not.toBeNull();
        expect(insights.sessionQuality).toBeDefined();
        // Settle time may or may not be found depending on HR pattern in 120s
        if (insights.settleTime) {
            expect(insights.settleTime.seconds).toBeLessThanOrEqual(120);
        }
    });

    it('produces valid 45-min deep session matching original profile behavior', () => {
        const tel = generateMockTelemetry(BASE_MS, 2700, 'deep');
        const insights = analyzeSession(tel);
        expect(insights.sessionQuality).toBe('deep_absorption');
        expect(insights.settleTime).not.toBeNull();
    });
});
