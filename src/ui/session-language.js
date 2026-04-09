import { formatDuration } from '../utils/date-helpers.js';

export function computeHeartRateDelta(hrSeries) {
    if (!hrSeries || hrSeries.length < 2) return null;
    return Math.round(hrSeries[hrSeries.length - 1].value - hrSeries[0].value);
}

export function formatHeartRateDelta(delta) {
    if (delta == null) return '—';
    if (delta === 0) return 'Steady';
    return delta < 0 ? `Down ${Math.abs(delta)} bpm` : `Up ${delta} bpm`;
}

export function buildSessionSummary({ hr = [], insights = null } = {}) {
    const delta = computeHeartRateDelta(hr);
    const settleSeconds = insights?.settleTime?.seconds ?? null;

    return {
        delta,
        deltaLabel: formatHeartRateDelta(delta),
        description: describeSessionEvidence({ delta, settleSeconds }),
    };
}

export function buildHistorySummary(session) {
    const settleSeconds = session?.insights?.settleTime?.seconds ?? null;
    if (settleSeconds != null) return `Settled in ${formatDuration(settleSeconds)}`;
    return 'Quiet record';
}

function describeSessionEvidence({ delta, settleSeconds }) {
    if (settleSeconds != null && delta != null && delta <= -8) {
        return 'Dropped early, then stayed steady.';
    }
    if (settleSeconds != null) {
        return 'Settled gradually over the session.';
    }
    if (delta != null && delta >= 4) {
        return 'Heart rate remained elevated.';
    }
    if (delta != null && delta <= -6) {
        return 'Heart rate eased down without a clear settle.';
    }
    return 'Little physiological change showed up.';
}
