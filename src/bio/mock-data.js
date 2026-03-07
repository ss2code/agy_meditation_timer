// mock-data.js — Synthetic telemetry profiles for testing BioMathEngine
// Phase 4: Used in Vitest unit tests.

/**
 * Generate an array of time-series points.
 * @param {number} startMs - start epoch ms
 * @param {number} durationSecs
 * @param {number} intervalSecs - sample interval
 * @param {function(number): number} valueFn - given elapsed seconds, returns value
 * @returns {Array<{timestamp: string, value: number}>}
 */
function makeSeries(startMs, durationSecs, intervalSecs, valueFn) {
    const points = [];
    for (let t = 0; t <= durationSecs; t += intervalSecs) {
        points.push({
            timestamp: new Date(startMs + t * 1000).toISOString(),
            value: parseFloat(valueFn(t).toFixed(2)),
        });
    }
    return points;
}

const BASE_MS = new Date('2026-03-06T08:00:00Z').getTime();
const DURATION = 45 * 60; // 45 minutes in seconds

/**
 * Profile A — "The Restless Mind"
 * High starting HR, erratic fluctuations, never settles.
 * Expected: settleTime = null, no breathless periods, friction flags.
 */
export const PROFILE_RESTLESS = {
    hr: makeSeries(BASE_MS, DURATION, 5, (t) => {
        const noise = (Math.sin(t * 0.3) + Math.cos(t * 0.7)) * 6;
        return 80 + noise;
    }),
    hrv: makeSeries(BASE_MS, DURATION, 1, (t) => {
        // Erratic RR intervals (600-900ms range, low coherence)
        return 750 + Math.sin(t * 1.3) * 120 + Math.random() * 60;
    }),
    temp: makeSeries(BASE_MS, DURATION, 30, (t) => {
        // Flat to slightly declining
        return 33.2 - (t / DURATION) * 0.3 + (Math.random() - 0.5) * 0.1;
    }),
    spo2: makeSeries(BASE_MS, DURATION, 60, () => 97 + (Math.random() - 0.5) * 0.5),
};

/**
 * Profile B — "Deep Absorption"
 * HR smooth decline, coherent HRV with clear RSA, rising skin temp.
 * Expected: settleTime ~3min, breathless periods, rising trend, deep_absorption.
 */
export const PROFILE_DEEP = {
    hr: makeSeries(BASE_MS, DURATION, 5, (t) => {
        // Smooth decline from 75 to 58 over first 10 min, then stable
        const target = t < 600 ? 75 - (t / 600) * 17 : 58;
        return target + Math.sin(t * 0.05) * 2;
    }),
    hrv: makeSeries(BASE_MS, DURATION, 1, (t) => {
        // Coherent RSA wave at ~5 bpm (0.083 Hz), period = 12s
        const baseRR = 900 + (t / DURATION) * 100; // Rising as HR drops
        const rsaWave = Math.sin((2 * Math.PI * t) / 12) * 80; // 5 bpm RSA
        return baseRR + rsaWave;
    }),
    temp: makeSeries(BASE_MS, DURATION, 30, (t) => {
        // Steady rise from 33.0 to 34.5°C
        return 33.0 + (t / DURATION) * 1.5 + (Math.random() - 0.5) * 0.05;
    }),
    spo2: makeSeries(BASE_MS, DURATION, 60, () => 97.5 + (Math.random() - 0.5) * 0.5),
};

/**
 * Profile C — "Somnolence"
 * Dropping HR + respiration, with SpO2 also dropping.
 * Expected: torpidFlag = true, somnolent classification.
 */
export const PROFILE_SOMNOLENT = {
    hr: makeSeries(BASE_MS, DURATION, 5, (t) => {
        return 70 - (t / DURATION) * 15 + (Math.random() - 0.5) * 3;
    }),
    hrv: makeSeries(BASE_MS, DURATION, 1, (t) => {
        // Moderate coherence, slow RSA (approaching sleep)
        const baseRR = 820 + (t / DURATION) * 150;
        const rsaWave = Math.sin((2 * Math.PI * t) / 20) * 50;
        return baseRR + rsaWave;
    }),
    temp: makeSeries(BASE_MS, DURATION, 30, (t) => {
        return 33.5 + (t / DURATION) * 0.4 + (Math.random() - 0.5) * 0.1;
    }),
    spo2: makeSeries(BASE_MS, DURATION, 30, (t) => {
        // Drops from 97 to 93% in the second half
        if (t < DURATION / 2) return 97 - (Math.random() * 0.5);
        const drop = ((t - DURATION / 2) / (DURATION / 2)) * 4;
        return 97 - drop - (Math.random() * 0.5);
    }),
};
