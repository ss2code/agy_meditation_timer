// health-connect-service.js — Android Health Connect via @capgo/capacitor-health
// Wraps the native plugin with a clean interface used by timer-view.js.
// All methods return graceful defaults when called on web (non-native).

import { Health } from '@capgo/capacitor-health';

const HC_READ_TYPES  = ['heartRate', 'heartRateVariability', 'oxygenSaturation', 'respiratoryRate'];
const HC_WRITE_TYPES = ['heartRate', 'oxygenSaturation', 'respiratoryRate'];

/**
 * Check whether Health Connect is available on this device.
 * @returns {Promise<'available'|'notInstalled'|'notSupported'>}
 */
export async function checkAvailability() {
    try {
        const result = await Health.isAvailable();
        console.log('[HC] isAvailable:', JSON.stringify(result));
        return result.available ? 'available' : 'notInstalled';
    } catch (err) {
        console.error('[HC] isAvailable error:', err);
        return 'notSupported';
    }
}

/**
 * Request read + write permissions (write needed for dev-panel seeding).
 * On production, only read types are needed; write types are harmless extras.
 * @returns {Promise<{ granted: boolean, missing: string[] }>}
 */
export async function requestReadWritePermissions() {
    try {
        const status = await Health.requestAuthorization({
            read:  HC_READ_TYPES,
            write: HC_WRITE_TYPES,
        });
        console.log('[HC] requestAuthorization (rw) result:', JSON.stringify(status));
        const missing = HC_READ_TYPES.filter((t) => !status.readAuthorized.includes(t));
        const granted = status.readAuthorized.includes('heartRate');
        return { granted, missing };
    } catch (err) {
        console.error('[HC] requestAuthorization (rw) error:', err);
        return { granted: false, missing: HC_READ_TYPES };
    }
}

/**
 * Seed synthetic "Deep Absorption" biometric data into Health Connect.
 * Used exclusively by the dev panel on AVD to test the Phase 6 query flow.
 *
 * Data pattern mirrors PROFILE_DEEP:
 *   HR: 75→58 bpm decline over first 10 min, then stable, with 5-bpm RSA wave
 *   SpO2: stable 97–98%
 *   Respiratory Rate: 5–7 br/min
 *
 * @param {number} startMs - epoch ms for session start
 * @param {number} durationSecs - session duration (default 2700 = 45 min)
 * @param {function} [onProgress] - called with (writtenCount, totalCount)
 */
export async function seedTestData(startMs, durationSecs = 2700, onProgress) {
    const endMs = startMs + durationSecs * 1000;

    // HR every 30 s — 90 samples for 45 min
    const HR_INTERVAL = 30_000;
    // SpO2 + RespRate every 5 min — 9 samples each
    const BIO_INTERVAL = 5 * 60_000;

    const hrCount   = Math.floor((endMs - startMs) / HR_INTERVAL);
    const bioCount  = Math.floor((endMs - startMs) / BIO_INTERVAL) * 2;
    const total     = hrCount + bioCount;
    let written = 0;

    // Heart Rate
    for (let t = startMs; t < endMs; t += HR_INTERVAL) {
        const sec    = (t - startMs) / 1000;
        const target = sec < 600 ? 75 - (sec / 600) * 17 : 58;
        const rsaWave = Math.sin((2 * Math.PI * sec) / 12) * 4;
        const bpm    = Math.round(target + rsaWave);
        await Health.saveSample({
            dataType: 'heartRate',
            value: bpm,
            startDate: new Date(t).toISOString(),
            endDate:   new Date(t + HR_INTERVAL).toISOString(),
        });
        written++;
        onProgress?.(written, total);
    }

    // SpO2 + Respiratory Rate
    for (let t = startMs; t < endMs; t += BIO_INTERVAL) {
        const spo2 = 97 + Math.random() * 1;
        const resp = 5 + Math.random() * 1.5;
        await Promise.all([
            Health.saveSample({
                dataType: 'oxygenSaturation',
                value: parseFloat(spo2.toFixed(1)),
                startDate: new Date(t).toISOString(),
                endDate:   new Date(t + BIO_INTERVAL).toISOString(),
            }),
            Health.saveSample({
                dataType: 'respiratoryRate',
                value: parseFloat(resp.toFixed(1)),
                startDate: new Date(t).toISOString(),
                endDate:   new Date(t + BIO_INTERVAL).toISOString(),
            }),
        ]);
        written += 2;
        onProgress?.(written, total);
    }
}

/**
 * Request read permissions for all Health Connect data types.
 * Only heartRate is REQUIRED — others are optional (device may not support them).
 * @returns {Promise<{ granted: boolean, missing: string[] }>}
 */
export async function requestPermissions() {
    try {
        const status = await Health.requestAuthorization({ read: HC_READ_TYPES });
        console.log('[HC] requestAuthorization result:', JSON.stringify(status));
        const missing = HC_READ_TYPES.filter((t) => !status.readAuthorized.includes(t));
        // Only heartRate is required — others are nice-to-have
        const granted = status.readAuthorized.includes('heartRate');
        return { granted, missing };
    } catch (err) {
        console.error('[HC] requestAuthorization error:', err);
        return { granted: false, missing: HC_READ_TYPES };
    }
}

/**
 * Check current permission status without prompting the user.
 * Only heartRate is REQUIRED — others are optional.
 * @returns {Promise<{ granted: boolean, missing: string[] }>}
 */
export async function checkPermissions() {
    try {
        const status = await Health.checkAuthorization({ read: HC_READ_TYPES });
        console.log('[HC] checkAuthorization result:', JSON.stringify(status));
        const missing = HC_READ_TYPES.filter((t) => !status.readAuthorized.includes(t));
        const granted = status.readAuthorized.includes('heartRate');
        return { granted, missing };
    } catch (err) {
        console.error('[HC] checkAuthorization error:', err);
        return { granted: false, missing: HC_READ_TYPES };
    }
}

/**
 * Query all biometric signals for a session time window.
 * Returns telemetry in the format expected by analyzeSession().
 *
 * @param {string} startTimestamp - ISO 8601 session start
 * @param {string} endTimestamp   - ISO 8601 session end
 * @returns {Promise<{
 *   hr:   Array<{timestamp: string, value: number}>,
 *   hrv:  Array<{timestamp: string, value: number}>,
 *   spo2: Array<{timestamp: string, value: number}>,
 *   resp: Array<{timestamp: string, value: number}>,
 *   temp: Array<{timestamp: string, value: number}>,
 *   source: 'health_connect'
 * }>}
 */
export async function querySession(startTimestamp, endTimestamp) {
    const durationMins = ((new Date(endTimestamp) - new Date(startTimestamp)) / 60000).toFixed(1);
    console.log(`[HC] querySession window: ${startTimestamp} → ${endTimestamp} (${durationMins} min)`);
    const opts = { startDate: startTimestamp, endDate: endTimestamp, ascending: true, limit: 2000 };

    const [hrResult, hrvResult, spo2Result, respResult] = await Promise.allSettled([
        Health.readSamples({ ...opts, dataType: 'heartRate' }),
        Health.readSamples({ ...opts, dataType: 'heartRateVariability' }),
        Health.readSamples({ ...opts, dataType: 'oxygenSaturation' }),
        Health.readSamples({ ...opts, dataType: 'respiratoryRate' }),
    ]);

    // Log raw results for debugging HC issues
    for (const [name, result] of [['HR', hrResult], ['HRV', hrvResult], ['SpO2', spo2Result], ['Resp', respResult]]) {
        if (result.status === 'fulfilled') {
            const n = result.value?.samples?.length ?? result.value?.length ?? 0;
            console.log(`[HC]   ${name}: ${n} samples`);
        } else {
            console.warn(`[HC]   ${name}: REJECTED —`, result.reason);
        }
    }

    const toSeries = (result) => {
        if (result.status !== 'fulfilled') return [];
        // Handle both { samples: [...] } and direct array responses
        const samples = result.value?.samples ?? result.value ?? [];
        if (!Array.isArray(samples)) return [];
        return samples.map((s) => ({ timestamp: s.startDate, value: s.value }));
    };

    return {
        hr:   toSeries(hrResult),
        hrv:  toSeries(hrvResult),   // RMSSD ms (sparse, ~1 per 5 min)
        spo2: toSeries(spo2Result),
        resp: toSeries(respResult),  // direct br/min from HC (preferred over derived)
        temp: [],                    // skin temperature not exposed by this HC plugin
        source: 'health_connect',
    };
}
