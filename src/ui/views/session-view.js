// session-view.js — Session detail: bio insights summary + bio-signal charts

import { formatDuration } from '../../utils/date-helpers.js';
import { escapeHtml } from '../../utils/escape-html.js';
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
import * as healthConnect from '../../bio/health-connect-service.js';

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

        ${_insightsCard(insights, session)}

        ${telemetry ? _diagnosticsPanel(telemetry, insights, session) : ''}
        ${telemetry ? _chartSectionHTML(insights) : ''}
    `;

    document.getElementById('sessionBackBtn')?.addEventListener('click', () => {
        navigateTo('history');
    });

    if (telemetry) {
        await _renderCharts(container, telemetry, insights);
    }

    // Always show "Update Health Connect" on native — lets user pull fresh/additional data
    if (window.Capacitor?.isNativePlatform?.()) {
        _addHCUpdateButton(container, session, telemetry);
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
    const { hr = [], hrv = [], spo2 = [], resp = [] } = telemetry;

    // Use the first HR sample as the session start anchor for elapsed-time x-axis
    const startMs = hr.length ? new Date(hr[0].timestamp).getTime() : 0;
    const toElapsed = (isoStr) => (new Date(isoStr).getTime() - startMs) / 1000;

    const hrData   = hr.map((p) => ({ x: toElapsed(p.timestamp), y: p.value }));
    const hrvData  = hrv.map((p) => ({ x: toElapsed(p.timestamp), y: p.value }));
    const spo2Data = spo2.map((p) => ({ x: toElapsed(p.timestamp), y: p.value }));

    // All charts share the same x-axis range (session duration from HR data)
    const xMax = hrData.length ? hrData[hrData.length - 1].x : undefined;

    // — Heart Rate chart (with settle-time vertical line) —
    const hrAnnotations = insights?.settleTime?.timestamp
        ? [{ x: toElapsed(insights.settleTime.timestamp), label: 'Settle' }]
        : [];
    const hrCanvas = container.querySelector('#chart-hr');
    if (hrCanvas && hrData.length) {
        _activeCharts.push(await createChart(
            hrCanvas,
            annotatedLineChartConfig('HR', hrData, hrAnnotations, { color: '#EF5350', yLabel: 'bpm', xElapsed: true, xMax })
        ));
    }

    // — HRV / Respiration dual chart —
    // Respiration series: direct from HC, or RSA-derived from dense HRV/HR
    const rawResp = resp.length
        ? resp.map((p) => ({ timestamp: p.timestamp, breathsPerMinute: p.value }))
        : hrv.length >= 10
            ? extractRespirationFromHRV(hrv)
            : extractRespirationFromHR(hr);
    const respData = rawResp.map((p) => ({ x: toElapsed(p.timestamp), y: p.breathsPerMinute }));
    const hrvCanvas = container.querySelector('#chart-hrv');
    if (hrvCanvas && (hrvData.length || respData.length)) {
        const hLabel = hrv.length >= 10 ? 'RR (ms)' : 'RMSSD (ms)';
        _activeCharts.push(await createChart(
            hrvCanvas,
            dualLineChartConfig(hLabel, hrvData, 'Resp (br/m)', respData, {
                color1: '#42A5F5', color2: '#66BB6A',
                yLabel1: 'ms', yLabel2: 'br/m', xElapsed: true, xMax,
            })
        ));
    }

    // — SpO2 chart (torpor periods highlighted) —
    const spo2Annotations = (insights?.spo2?.torpidPeriods || []).map((p) => ({
        type: 'box', xMin: toElapsed(p.start), xMax: toElapsed(p.end), color: 'rgba(66,165,245,0.18)',
    }));
    const spo2Canvas = container.querySelector('#chart-spo2');
    if (spo2Canvas && spo2Data.length) {
        _activeCharts.push(await createChart(
            spo2Canvas,
            annotatedLineChartConfig('SpO₂', spo2Data, spo2Annotations, { color: '#7E57C2', yLabel: '%', xElapsed: true, xMax })
        ));
    }
}

function _insightsCard(insights, session) {
    if (!insights) {
        return `
            <div class="summary-card">
                <h3 class="card-heading">Bio Insights</h3>
                <p class="empty-state">No bio-data for this session.</p>
            </div>
        `;
    }

    const isHC = session?.telemetrySource === 'health_connect';
    const sourceBadge = session?.telemetrySource
        ? `<span class="source-badge ${isHC ? 'source-badge--hc' : 'source-badge--mock'}">${isHC ? 'Health Connect' : 'Mock Data'}</span>`
        : '';

    const qualityBadge = insights.sessionQuality
        ? `<div class="session-quality quality-badge quality-badge--${escapeHtml(insights.sessionQuality)}">${escapeHtml(_qualityLabel(insights.sessionQuality))}</div>`
        : '';

    const respConf = insights.respirationRate?.confidence;
    const respSub = respConf && respConf !== 'none' && respConf !== 'high'
        ? `<span class="insight-sub">${respConf} confidence</span>`
        : '';

    return `
        <div class="summary-card">
            <h3 class="card-heading">Bio Insights ${sourceBadge}</h3>
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
                    ${respSub}
                </div>
            </div>
            ${qualityBadge}
        </div>
    `;
}

function _diagnosticsPanel(telemetry, insights, session) {
    const { hr = [], hrv = [], temp = [], spo2 = [], resp = [] } = telemetry;
    const src = session?.telemetrySource || 'unknown';
    const reason = session?.telemetryReason || '';
    const diag = insights?.telemetryDiagnostics;
    const respMeta = insights?.respirationRate;

    const stat = (arr, label) => {
        if (!arr.length) return `<tr><td>${label}</td><td>0</td><td colspan="3">—</td></tr>`;
        const vals = arr.map((p) => p.value);
        const min = Math.min(...vals).toFixed(1);
        const max = Math.max(...vals).toFixed(1);
        const mean = (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
        return `<tr><td>${label}</td><td>${arr.length}</td><td>${min}</td><td>${max}</td><td>${mean}</td></tr>`;
    };

    const warnings = [];
    if (respMeta?.source === 'insufficient_data') warnings.push('Insufficient data for respiration analysis');

    const qr = session?.queriedRange;
    const fmtTs = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    const queriedMins = qr ? ((new Date(qr.end) - new Date(qr.start)) / 60000).toFixed(1) : null;
    const queriedLine = qr
        ? `<p><strong>Queried:</strong> ${fmtTs(qr.start)} → ${fmtTs(qr.end)} (${queriedMins} min)</p>`
        : '';

    return `
        <details class="diagnostics-panel">
            <summary class="card-heading" style="cursor:pointer">Raw Data</summary>
            <div class="diag-content">
                <p><strong>Source:</strong> ${escapeHtml(src)}${reason ? ` — ${escapeHtml(reason)}` : ''}</p>
                ${queriedLine}
                <p><strong>Respiration:</strong> ${respMeta?.source || '—'} (${respMeta?.confidence || '—'})</p>
                <table class="diag-table">
                    <thead><tr><th>Signal</th><th>#</th><th>Min</th><th>Max</th><th>Mean</th></tr></thead>
                    <tbody>
                        ${stat(hr, 'HR')}
                        ${stat(hrv, 'HRV')}
                        ${stat(spo2, 'SpO2')}
                        ${stat(resp, 'Resp')}
                        ${stat(temp, 'Temp')}
                    </tbody>
                </table>
                ${warnings.length ? warnings.map((w) => `<p class="diag-warning">${w}</p>`).join('') : ''}
            </div>
        </details>
    `;
}

function _addHCUpdateButton(container, session, existingTelemetry) {
    const card = container.querySelector('.summary-card');
    if (!card) return;

    const btn = document.createElement('button');
    btn.className = 'btn primary hc-retry-btn';
    btn.textContent = 'Update Health Connect';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Checking permissions…';
        try {
            // Ensure HC permissions before querying
            let { granted } = await healthConnect.checkPermissions();
            if (!granted) {
                ({ granted } = await healthConnect.requestPermissions());
                if (!granted) {
                    btn.textContent = 'Permissions not granted — Update';
                    btn.disabled = false;
                    return;
                }
            }

            btn.textContent = 'Querying Health Connect…';

            // Fixed session window — always use the original meditation start/end
            const endTs = session.endTimestamp;
            const startTs = session.startTimestamp
                || new Date(new Date(endTs).getTime() - session.duration * 1000).toISOString();
            const incoming = await healthConnect.querySession(startTs, endTs);

            // Filter HC results to the exact session window (HC may return extra data)
            const startMs = new Date(startTs).getTime();
            const endMs = new Date(endTs).getTime();
            const clip = (arr) => (arr || []).filter((p) => {
                const t = new Date(p.timestamp).getTime();
                return t >= startMs && t <= endMs;
            });

            // Always replace with fresh data — no additive merge
            const telemetry = {
                hr:   clip(incoming.hr),
                hrv:  clip(incoming.hrv),
                spo2: clip(incoming.spo2),
                resp: clip(incoming.resp),
                temp: clip(incoming.temp),
                source: 'health_connect',
            };

            if (!telemetry.hr.length) {
                btn.textContent = 'No data yet — Update';
                btn.disabled = false;
                return;
            }

            const insights = analyzeSession(telemetry);
            await _storage.saveTelemetry(session.id, telemetry);
            session.hasTelemetry = true;
            session.insights = insights;
            session.telemetrySource = 'health_connect';
            session.telemetryReason = `HR: ${telemetry.hr.length}, HRV: ${telemetry.hrv.length}, SpO2: ${telemetry.spo2.length}`;
            session.queriedRange = { start: startTs, end: endTs };
            await _storage.saveSession(session);
            renderSessionView([session.id]);
        } catch (err) {
            console.error('[HC update]', err);
            btn.textContent = 'Error — Update';
            btn.disabled = false;
        }
    });
    card.appendChild(btn);
}

function _qualityLabel(quality) {
    const map = {
        restless: 'Restless', settling: 'Settling', absorbed: 'Absorbed',
        deep_absorption: 'Deep Absorption', somnolent: 'Somnolent',
    };
    return map[quality] || quality;
}
