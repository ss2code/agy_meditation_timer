// session-view.js — Session detail: bio insights summary + bio-signal charts

import { formatDuration } from '../../utils/date-helpers.js';
import { navigateTo } from '../router.js';
import {
    createChart,
    annotatedLineChartConfig,
    dualLineChartConfig,
} from '../components/chart-panel.js';
import {
    analyzeSession,
    extractRespirationFromHRV,
    extractRespirationFromHR,
} from '../../bio/bio-math-engine.js';

let _storage = null;
const _activeCharts = [];

export function mountSessionView(storage) {
    _storage = storage;
}

export async function renderSessionView(params) {
    const sessionId = params[0];
    const container = document.getElementById('view-session');
    if (!container || !_storage) return;

    // Destroy charts from any previous render
    _activeCharts.forEach((c) => c.destroy());
    _activeCharts.length = 0;

    const session = await _storage.getSession(sessionId);
    if (!session) {
        container.innerHTML = '<p class="empty-state">Session not found.</p>';
        return;
    }

    const date = new Date(session.endTimestamp || session.startTimestamp);
    const dateStr = date.toLocaleDateString([], {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Fetch telemetry; re-derive insights if not cached
    let telemetry = null;
    let insights = session.insights;
    if (session.hasTelemetry) {
        const raw = await _storage.getTelemetry(sessionId);
        if (raw && !Array.isArray(raw) && Array.isArray(raw.hr)) {
            telemetry = raw;
            if (!insights) insights = analyzeSession(telemetry);
        }
    }

    container.innerHTML = `
        <div class="view-header">
            <button class="back-btn" id="sessionBackBtn">← Back</button>
            <h2 class="view-title">Session</h2>
        </div>

        <div class="session-meta">
            <div class="session-date">${dateStr} · ${timeStr}</div>
            <div class="session-duration">${formatDuration(session.duration)}</div>
        </div>

        ${_insightsCard(insights)}

        ${telemetry ? _chartSectionHTML(insights) : ''}
    `;

    document.getElementById('sessionBackBtn')?.addEventListener('click', () => {
        navigateTo('history');
    });

    if (telemetry) {
        await _renderCharts(container, telemetry, insights);
    }
}

function _chartSectionHTML(insights) {
    const hasSpo2 = insights?.spo2?.average != null;
    return `
        <div class="chart-section">
            <div class="summary-card">
                <h3 class="card-heading">Heart Rate</h3>
                <div class="chart-canvas-wrap"><canvas id="chart-hr"></canvas></div>
            </div>
            <div class="summary-card">
                <h3 class="card-heading">HRV / Respiration</h3>
                <div class="chart-canvas-wrap"><canvas id="chart-hrv"></canvas></div>
            </div>
            <div class="summary-card">
                <h3 class="card-heading">Skin Temperature</h3>
                <div class="chart-canvas-wrap"><canvas id="chart-temp"></canvas></div>
            </div>
            ${hasSpo2 ? `
            <div class="summary-card">
                <h3 class="card-heading">SpO&#x2082;</h3>
                <div class="chart-canvas-wrap"><canvas id="chart-spo2"></canvas></div>
            </div>
            ` : ''}
        </div>
    `;
}

async function _renderCharts(container, telemetry, insights) {
    const { hr = [], hrv = [], temp = [], spo2 = [], resp = [] } = telemetry;

    const hrData   = hr.map((p) => ({ x: p.timestamp, y: p.value }));
    const hrvData  = hrv.map((p) => ({ x: p.timestamp, y: p.value }));
    const tempData = temp.map((p) => ({ x: p.timestamp, y: p.value }));
    const spo2Data = spo2.map((p) => ({ x: p.timestamp, y: p.value }));

    // Respiration series: direct from HC, or RSA-derived from HRV/HR
    const rawResp = resp.length
        ? resp.map((p) => ({ timestamp: p.timestamp, breathsPerMinute: p.value }))
        : hrv.length >= 10
            ? extractRespirationFromHRV(hrv)
            : extractRespirationFromHR(hr);
    const respData = rawResp.map((p) => ({ x: p.timestamp, y: p.breathsPerMinute }));

    // — Heart Rate chart (with settle-time vertical line) —
    const hrAnnotations = insights?.settleTime?.timestamp
        ? [{ x: insights.settleTime.timestamp, label: 'Settle' }]
        : [];
    const hrCanvas = container.querySelector('#chart-hr');
    if (hrCanvas && hrData.length) {
        _activeCharts.push(await createChart(
            hrCanvas,
            annotatedLineChartConfig('HR', hrData, hrAnnotations, { color: '#EF5350', yLabel: 'bpm' })
        ));
    }

    // — HRV / Respiration dual chart —
    const hrvCanvas = container.querySelector('#chart-hrv');
    if (hrvCanvas && (hrvData.length || respData.length)) {
        const hLabel = hrv.length >= 10 ? 'RR (ms)' : 'RMSSD (ms)';
        _activeCharts.push(await createChart(
            hrvCanvas,
            dualLineChartConfig(hLabel, hrvData, 'Resp (br/m)', respData, {
                color1: '#42A5F5', color2: '#66BB6A',
                yLabel1: 'ms', yLabel2: 'br/m',
            })
        ));
    }

    // — Skin Temperature chart (friction periods shaded) —
    const tempAnnotations = (insights?.skinTemp?.frictionPeriods || []).map((p) => ({
        type: 'box', xMin: p.start, xMax: p.end, color: 'rgba(239,83,80,0.10)',
    }));
    const tempCanvas = container.querySelector('#chart-temp');
    if (tempCanvas && tempData.length) {
        _activeCharts.push(await createChart(
            tempCanvas,
            annotatedLineChartConfig('Temp', tempData, tempAnnotations, { color: '#FFA726', yLabel: '°C' })
        ));
    }

    // — SpO2 chart (torpor periods highlighted) —
    const spo2Annotations = (insights?.spo2?.torpidPeriods || []).map((p) => ({
        type: 'box', xMin: p.start, xMax: p.end, color: 'rgba(66,165,245,0.18)',
    }));
    const spo2Canvas = container.querySelector('#chart-spo2');
    if (spo2Canvas && spo2Data.length) {
        _activeCharts.push(await createChart(
            spo2Canvas,
            annotatedLineChartConfig('SpO₂', spo2Data, spo2Annotations, { color: '#7E57C2', yLabel: '%' })
        ));
    }
}

function _insightsCard(insights) {
    if (!insights) {
        return `
            <div class="summary-card">
                <h3 class="card-heading">Bio Insights</h3>
                <p class="empty-state">No bio-data for this session.</p>
            </div>
        `;
    }

    const qualityBadge = insights.sessionQuality
        ? `<div class="session-quality quality-badge quality-badge--${insights.sessionQuality}">${_qualityLabel(insights.sessionQuality)}</div>`
        : '';

    return `
        <div class="summary-card">
            <h3 class="card-heading">Bio Insights</h3>
            <div class="insight-grid">
                <div class="insight-item">
                    <span class="insight-label">Settle Time</span>
                    <span class="insight-value">${insights.settleTime ? formatDuration(insights.settleTime.seconds) : '—'}</span>
                </div>
                <div class="insight-item">
                    <span class="insight-label">Avg HR</span>
                    <span class="insight-value">${insights.avgHR != null ? `${insights.avgHR} bpm` : '—'}</span>
                </div>
                <div class="insight-item">
                    <span class="insight-label">Respiration</span>
                    <span class="insight-value">${insights.respirationRate?.average != null ? `${insights.respirationRate.average.toFixed(1)} br/m` : '—'}</span>
                </div>
                <div class="insight-item">
                    <span class="insight-label">Skin Temp Δ</span>
                    <span class="insight-value">${insights.skinTemp?.delta != null ? `${insights.skinTemp.delta > 0 ? '+' : ''}${insights.skinTemp.delta.toFixed(1)}°C` : '—'}</span>
                </div>
            </div>
            ${qualityBadge}
        </div>
    `;
}

function _qualityLabel(quality) {
    const map = {
        restless: 'Restless', settling: 'Settling', absorbed: 'Absorbed',
        deep_absorption: 'Deep Absorption', somnolent: 'Somnolent',
    };
    return map[quality] || quality;
}
