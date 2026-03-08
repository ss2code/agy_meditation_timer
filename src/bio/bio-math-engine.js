// bio-math-engine.js — Pure biofeedback analysis functions
// All functions are stateless and fully unit-testable.
// No DOM, no storage, no side effects.

// ─── Constants ────────────────────────────────────────────────────────────────

/** bpm below which a window counts as "deep/breathless" (general insight) */
const BREATHLESS_BPM = 6;
/** bpm below which a window is a torpor candidate (strict, requires SpO2 confirmation) */
const TORPOR_BPM = 4;
const SPO2_ABS_THRESHOLD = 94;   // % hard floor for torpor
const SPO2_DROP_THRESHOLD = 3;   // % relative drop from baseline for torpor

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculate when HR settles within 5% of session minimum.
 * "Settled" = stays in the 5% band continuously for >= 60s.
 *
 * @param {Array<{timestamp: string, value: number}>} hrSeries
 * @returns {{ seconds: number, timestamp: string } | null}
 */
export function calculateSettleTime(hrSeries) {
    if (!hrSeries || hrSeries.length < 2) return null;

    const sessionStart = new Date(hrSeries[0].timestamp).getTime();

    // Exclude first 30s as warm-up noise
    const stable = hrSeries.filter(
        (p) => new Date(p.timestamp).getTime() - sessionStart >= 30_000
    );
    if (stable.length === 0) return null;

    const minHR = Math.min(...stable.map((p) => p.value));
    const upperBand = minHR * 1.05;
    const WINDOW_MS = 60_000;

    for (let i = 0; i < hrSeries.length; i++) {
        const windowStart = new Date(hrSeries[i].timestamp).getTime();
        const windowEnd = windowStart + WINDOW_MS;

        const inWindow = hrSeries.filter((p) => {
            const t = new Date(p.timestamp).getTime();
            return t >= windowStart && t <= windowEnd;
        });

        if (inWindow.length === 0) continue;
        if (inWindow.every((p) => p.value >= minHR && p.value <= upperBand)) {
            return {
                seconds: Math.round((windowStart - sessionStart) / 1000),
                timestamp: hrSeries[i].timestamp,
            };
        }
    }
    return null;
}

/**
 * Compute RMSSD from RR intervals (standard short-term HRV metric).
 *
 * @param {number[]} rrIntervals - milliseconds
 * @returns {number} RMSSD in ms, 0 if insufficient data
 */
export function computeRMSSD(rrIntervals) {
    if (!rrIntervals || rrIntervals.length < 2) return 0;
    let sumSq = 0;
    for (let i = 1; i < rrIntervals.length; i++) {
        const d = rrIntervals[i] - rrIntervals[i - 1];
        sumSq += d * d;
    }
    return Math.sqrt(sumSq / (rrIntervals.length - 1));
}

/**
 * Extract breathing rate from HRV RR intervals via Respiratory Sinus Arrhythmia (RSA).
 * Input: per-beat RR intervals (ms). Delegates to _extractRespiration.
 *
 * @param {Array<{timestamp: string, value: number}>} rrIntervals - ms between beats
 * @param {number} [windowSeconds=60]
 * @returns {Array<{timestamp: string, breathsPerMinute: number}>}
 */
export function extractRespirationFromHRV(rrIntervals, windowSeconds = 60) {
    return _extractRespiration(rrIntervals, windowSeconds);
}

/**
 * Extract breathing rate from HR bpm series via Respiratory Sinus Arrhythmia (RSA).
 * HR rises on inhale and falls on exhale — same bandpass/zero-crossing algorithm as
 * extractRespirationFromHRV, but operates on the bpm signal directly.
 * Used when raw RR intervals are unavailable (e.g. Health Connect).
 *
 * @param {Array<{timestamp: string, value: number}>} hrSeries - bpm values
 * @param {number} [windowSeconds=60]
 * @returns {Array<{timestamp: string, breathsPerMinute: number}>}
 */
export function extractRespirationFromHR(hrSeries, windowSeconds = 60) {
    return _extractRespiration(hrSeries, windowSeconds);
}

/**
 * Core RSA respiration extraction from any scalar time-series.
 *
 * Algorithm:
 * 1. Resample to uniform 4 Hz via linear interpolation
 * 2. Remove baseline drift (25 s centered moving average)
 * 3. Sliding 60 s window: find dominant frequency in respiratory band
 *    via DFT with Hanning window + parabolic interpolation
 * 4. Return a reading every 30 s
 *
 * Previous approach (zero-crossing counting) undercounted when RSA amplitude
 * was low — common with sparse, pre-averaged Health Connect HR data.
 * Spectral peak detection finds the dominant oscillation regardless of amplitude.
 *
 * @param {Array<{timestamp: string, value: number}>} series
 * @param {number} windowSeconds
 * @returns {Array<{timestamp: string, breathsPerMinute: number}>}
 */
function _extractRespiration(series, windowSeconds) {
    if (!series || series.length < 10) return [];

    const RATE = 4; // Hz
    const DT_MS = 1000 / RATE;

    const startMs = new Date(series[0].timestamp).getTime();
    const endMs   = new Date(series[series.length - 1].timestamp).getTime();
    const totalMs = endMs - startMs;

    if (totalMs < windowSeconds * 1000) return [];

    // Nyquist guard: reject data too sparse for RSA extraction
    const effectiveRate = computeEffectiveSampleRate(series);
    if (effectiveRate < 0.1) return [];

    // Step 1: Resample to uniform 4 Hz
    const uniform = _resampleUniform(series, startMs, totalMs, DT_MS);
    if (uniform.length < windowSeconds * RATE) return [];

    // Step 2: Remove baseline drift (25 s centered moving average)
    const HP_WIN = Math.max(2, Math.round(25 * RATE));
    const baseline = _movingAvg(uniform, HP_WIN);
    const detrended = uniform.map((v, i) => v - baseline[i]);

    // Step 3: Sliding window — dominant frequency via DFT in respiratory band
    const winSamples  = windowSeconds * RATE;  // 240 at 4 Hz / 60 s
    const stepSamples = Math.round(RATE * 30); // step 30 s = 120 samples
    const result = [];

    for (let start = 0; start + winSamples <= detrended.length; start += stepSamples) {
        const freq = _dominantRespFrequency(detrended, start, start + winSamples, RATE);
        const bpm = parseFloat((freq * 60).toFixed(1));
        result.push({
            timestamp: new Date(startMs + (start / RATE) * 1000).toISOString(),
            breathsPerMinute: bpm,
        });
    }
    return result;
}

/**
 * Analyze skin temperature for the Surrender Heatmap.
 * Rising temp = peripheral vasodilation = sympathetic withdrawal.
 *
 * @param {Array<{timestamp: string, value: number}>} tempSeries - Celsius
 * @returns {{
 *   start: number|null, end: number|null, delta: number|null,
 *   trend: 'rising'|'falling'|'flat',
 *   frictionPeriods: Array<{start: string, end: string}>
 * }}
 */
export function analyzeSkinTemperature(tempSeries) {
    if (!tempSeries || tempSeries.length < 2) {
        return { start: null, end: null, delta: null, trend: 'flat', frictionPeriods: [] };
    }

    const startTemp = tempSeries[0].value;
    const endTemp   = tempSeries[tempSeries.length - 1].value;
    const delta     = parseFloat((endTemp - startTemp).toFixed(2));

    const trend = delta > 0.1 ? 'rising' : delta < -0.1 ? 'falling' : 'flat';
    const frictionPeriods = _detectFrictionPeriods(tempSeries);

    return { start: startTemp, end: endTemp, delta, trend, frictionPeriods };
}

/**
 * Detect torpor: correlated drop in both respiration and SpO2.
 * Torpor = throat muscle relaxation into sleep; distinct from transcendence
 * (where breathing slows but SpO2 remains stable).
 *
 * @param {Array<{timestamp: string, breathsPerMinute: number}>} respiration
 * @param {Array<{timestamp: string, value: number}>} spo2Series
 * @returns {{ torpidFlag: boolean, periods: Array<{start: string, end: string}> }}
 */
export function detectTorpor(respiration, spo2Series) {
    if (!respiration?.length || !spo2Series?.length) return { torpidFlag: false, periods: [] };

    // Baseline SpO2: average of first third of readings
    const baseN = Math.max(1, Math.floor(spo2Series.length / 3));
    const spo2Baseline = spo2Series.slice(0, baseN).reduce((s, p) => s + p.value, 0) / baseN;

    const periods = [];
    for (const r of respiration) {
        if (r.breathsPerMinute >= TORPOR_BPM) continue;

        // Find concurrent SpO2 readings (within ±60 s)
        const rTs = new Date(r.timestamp).getTime();
        const concurrent = spo2Series.filter(
            (p) => Math.abs(new Date(p.timestamp).getTime() - rTs) <= 60_000
        );
        if (!concurrent.length) continue;

        const avgSpo2 = concurrent.reduce((s, p) => s + p.value, 0) / concurrent.length;
        if (avgSpo2 < SPO2_ABS_THRESHOLD || spo2Baseline - avgSpo2 >= SPO2_DROP_THRESHOLD) {
            periods.push({ start: r.timestamp, end: r.timestamp });
        }
    }
    return { torpidFlag: periods.length > 0, periods };
}

/**
 * Classify overall session quality from computed insights.
 *
 * Priority order: somnolent > deep_absorption > absorbed > settling > restless
 *
 * @param {Object} insights - result of analyzeSession()
 * @returns {'restless'|'settling'|'absorbed'|'deep_absorption'|'somnolent'}
 */
export function classifySession(insights) {
    if (!insights) return 'restless';

    if (insights.spo2?.torpidFlag) return 'somnolent';

    const settleSeconds = insights.settleTime?.seconds ?? null;
    const breathlessCount = insights.respirationRate?.breathlessPeriodsCount ?? 0;
    const tempTrend = insights.skinTemp?.trend;

    if (breathlessCount > 0 && tempTrend === 'rising') return 'deep_absorption';
    if (settleSeconds !== null && settleSeconds < 300)   return 'absorbed';
    if (settleSeconds !== null)                          return 'settling';
    return 'restless';
}

/**
 * Orchestrate all analyses on a session's telemetry.
 *
 * @param {{
 *   hr:   Array<{timestamp: string, value: number}>,
 *   hrv:  Array<{timestamp: string, value: number}>,
 *   temp: Array<{timestamp: string, value: number}>,
 *   spo2: Array<{timestamp: string, value: number}>,
 *   resp?: Array<{timestamp: string, value: number}>  // optional: direct respiratory rate (br/min) from Health Connect
 * }} telemetry
 * @returns {Object} insights
 */
export function analyzeSession(telemetry) {
    const { hr = [], hrv = [], temp = [], spo2 = [], resp = [] } = telemetry;

    const rrValues = hrv.map((p) => p.value);

    // Respiration source priority:
    // 1. Direct respiratory rate from Health Connect (resp field)
    // 2. RSA extraction from dense RR intervals (mock/raw HRV)
    // 3. RSA extraction from HR bpm (fallback for real data without raw RR)
    let respirationSource = 'insufficient_data';
    let respirationConfidence = 'none';
    let respiration;

    if (resp.length) {
        respiration = resp.map((p) => ({ timestamp: p.timestamp, breathsPerMinute: p.value }));
        respirationSource = 'health_connect_direct';
        respirationConfidence = 'high';
    } else if (hrv.length >= 10) {
        respiration = extractRespirationFromHRV(hrv);
        if (respiration.length) {
            respirationSource = 'rsa_hrv';
            respirationConfidence = 'medium';
        }
    } else {
        respiration = extractRespirationFromHR(hr);
        if (respiration.length) {
            respirationSource = 'rsa_hr';
            respirationConfidence = 'low';
        }
    }
    if (!respiration) respiration = [];
    const tempAnalysis = analyzeSkinTemperature(temp);

    // Respiration stats
    const breathlessPeriods = respiration.filter((p) => p.breathsPerMinute < BREATHLESS_BPM);
    const avgResp = respiration.length
        ? parseFloat((respiration.reduce((s, p) => s + p.breathsPerMinute, 0) / respiration.length).toFixed(1))
        : null;
    const minResp = respiration.length
        ? parseFloat(Math.min(...respiration.map((p) => p.breathsPerMinute)).toFixed(1))
        : null;

    const torpor    = detectTorpor(respiration, spo2);
    const settleTime = calculateSettleTime(hr);

    const avgHR  = hr.length   ? Math.round(hr.reduce((s, p) => s + p.value, 0) / hr.length)     : null;
    const avgHRV = rrValues.length ? parseFloat(computeRMSSD(rrValues).toFixed(1))                : null;
    const avgSpo2 = spo2.length
        ? parseFloat((spo2.reduce((s, p) => s + p.value, 0) / spo2.length).toFixed(1))
        : null;

    const insights = {
        settleTime,
        avgHR,
        minHR: hr.length   ? parseFloat(Math.min(...hr.map((p) => p.value)).toFixed(1))   : null,
        maxHR: hr.length   ? parseFloat(Math.max(...hr.map((p) => p.value)).toFixed(1))   : null,
        avgHRV,
        respirationRate: {
            average: avgResp,
            minimum: minResp,
            breathlessPeriodsCount: breathlessPeriods.length,
            breathlessTotalSeconds: breathlessPeriods.length * 30, // step = 30 s
            source: respirationSource,
            confidence: respirationConfidence,
        },
        skinTemp: tempAnalysis,
        spo2: {
            average: avgSpo2,
            minimum: spo2.length ? parseFloat(Math.min(...spo2.map((p) => p.value)).toFixed(1)) : null,
            torpidFlag: torpor.torpidFlag,
            torpidPeriods: torpor.periods,
        },
        telemetryDiagnostics: {
            sampleCounts: {
                hr: hr.length, hrv: hrv.length, spo2: spo2.length,
                resp: resp.length, temp: temp.length,
            },
            effectiveRates: {
                hr:  computeEffectiveSampleRate(hr),
                hrv: computeEffectiveSampleRate(hrv),
            },
        },
        sessionQuality: null,
    };
    insights.sessionQuality = classifySession(insights);
    return insights;
}

/**
 * Compute effective sample rate in Hz from a time-series.
 * @param {Array<{timestamp: string}>} series
 * @returns {number} Hz (0 if fewer than 2 samples)
 */
export function computeEffectiveSampleRate(series) {
    if (!series || series.length < 2) return 0;
    const startMs = new Date(series[0].timestamp).getTime();
    const endMs   = new Date(series[series.length - 1].timestamp).getTime();
    const durationSecs = (endMs - startMs) / 1000;
    if (durationSecs <= 0) return 0;
    return (series.length - 1) / durationSecs;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Linearly interpolate a sparse time-series to a uniform sample grid.
 * O(n + m) — single forward pass with two-pointer advance.
 */
function _resampleUniform(series, startMs, totalMs, dtMs) {
    // Pre-parse timestamps once
    const times = series.map((p) => new Date(p.timestamp).getTime());
    const result = [];
    let j = 0;

    for (let t = 0; t <= totalMs; t += dtMs) {
        const absT = startMs + t;
        // Advance pointer while next sample is still before absT
        while (j < series.length - 2 && times[j + 1] <= absT) j++;
        const t0 = times[j];
        const t1 = j + 1 < series.length ? times[j + 1] : t0 + dtMs;
        const v0 = series[j].value;
        const v1 = j + 1 < series.length ? series[j + 1].value : v0;
        const frac = t1 > t0 ? Math.min(1, (absT - t0) / (t1 - t0)) : 0;
        result.push(v0 + frac * (v1 - v0));
    }
    return result;
}

/**
 * Centered symmetric moving average. O(n) via sliding sum.
 */
function _movingAvg(arr, win) {
    const result = new Array(arr.length);
    const half   = Math.floor(win / 2);
    let sum = 0, lo = 0, hi = 0;

    for (let i = 0; i < arr.length; i++) {
        // Expand right edge
        const newHi = Math.min(arr.length, i + half + 1);
        while (hi < newHi) sum += arr[hi++];
        // Shrink left edge
        const newLo = Math.max(0, i - half);
        while (lo < newLo) sum -= arr[lo++];
        result[i] = sum / (hi - lo);
    }
    return result;
}

/**
 * Find the dominant frequency in the respiratory band (0.05–0.6 Hz) via DFT.
 * Uses Hanning window to reduce spectral leakage and parabolic interpolation
 * for sub-bin frequency accuracy.
 *
 * Only computes DFT at ~30 bins in the respiratory range — O(N × bins) per window.
 *
 * @param {number[]} arr - detrended signal
 * @param {number} start - window start index
 * @param {number} end - window end index (exclusive)
 * @param {number} sampleRate - Hz
 * @returns {number} dominant frequency in Hz (0 if none found)
 */
function _dominantRespFrequency(arr, start, end, sampleRate) {
    const N = end - start;
    const freqRes = sampleRate / N;

    // Respiratory band: 0.05–0.6 Hz → 3–36 breaths/min
    const RESP_LO = 0.05;
    const RESP_HI = 0.6;
    const kMin = Math.max(1, Math.ceil(RESP_LO / freqRes));
    const kMax = Math.min(Math.floor(N / 2) - 1, Math.floor(RESP_HI / freqRes));
    if (kMin > kMax) return 0;

    // Precompute mean-removed, Hanning-windowed segment
    let mean = 0;
    for (let i = start; i < end; i++) mean += arr[i];
    mean /= N;

    const w = new Array(N);
    for (let n = 0; n < N; n++) {
        const hann = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
        w[n] = (arr[start + n] - mean) * hann;
    }

    // DFT at bins kMin-1 .. kMax+1 (extra margin for parabolic interpolation)
    const lo = Math.max(0, kMin - 1);
    const hi = Math.min(Math.floor(N / 2), kMax + 1);
    const power = new Array(hi - lo + 1);

    for (let k = lo; k <= hi; k++) {
        let re = 0, im = 0;
        const omega = (2 * Math.PI * k) / N;
        for (let n = 0; n < N; n++) {
            re += w[n] * Math.cos(omega * n);
            im -= w[n] * Math.sin(omega * n);
        }
        power[k - lo] = re * re + im * im;
    }

    // Find peak bin in respiratory band
    let maxP = 0, peakK = kMin;
    for (let k = kMin; k <= kMax; k++) {
        if (power[k - lo] > maxP) {
            maxP = power[k - lo];
            peakK = k;
        }
    }

    // Parabolic interpolation for sub-bin accuracy
    if (peakK > lo && peakK < hi && maxP > 0) {
        const pL = power[peakK - 1 - lo];
        const pC = power[peakK - lo];
        const pR = power[peakK + 1 - lo];
        const denom = 2 * pC - pL - pR;
        if (denom > 0) {
            const delta = 0.5 * (pR - pL) / denom;
            return (peakK + delta) * freqRes;
        }
    }

    return peakK * freqRes;
}

/**
 * Detect sustained temperature decline periods (proxy for friction / sympathetic arousal).
 * A period requires each step to drop by ≥ DECLINE_THRESHOLD for ≥ minDurationMs total.
 */
function _detectFrictionPeriods(tempSeries, minDurationMs = 120_000) {
    const DECLINE_PER_STEP = -0.02; // °C — must drop this much per sample interval
    const periods = [];
    let declineStart = null;

    for (let i = 1; i < tempSeries.length; i++) {
        const slope = tempSeries[i].value - tempSeries[i - 1].value;
        if (slope < DECLINE_PER_STEP) {
            if (declineStart === null) declineStart = i - 1;
        } else {
            if (declineStart !== null) {
                const dMs = new Date(tempSeries[i - 1].timestamp).getTime()
                          - new Date(tempSeries[declineStart].timestamp).getTime();
                if (dMs >= minDurationMs) {
                    periods.push({
                        start: tempSeries[declineStart].timestamp,
                        end:   tempSeries[i - 1].timestamp,
                    });
                }
                declineStart = null;
            }
        }
    }
    // Check if decline extends to end of series
    if (declineStart !== null) {
        const last = tempSeries.length - 1;
        const dMs  = new Date(tempSeries[last].timestamp).getTime()
                   - new Date(tempSeries[declineStart].timestamp).getTime();
        if (dMs >= minDurationMs) {
            periods.push({
                start: tempSeries[declineStart].timestamp,
                end:   tempSeries[last].timestamp,
            });
        }
    }
    return periods;
}
