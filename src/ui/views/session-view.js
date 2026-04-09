// session-view.js — Session detail: bio insights summary + bio-signal charts

import { formatDuration, getSessionReferenceDate } from '../../utils/date-helpers.js';
import { escapeHtml } from '../../utils/escape-html.js';
import { navigateTo } from '../router.js';
import {
    createChart,
    annotatedLineChartConfig,
} from '../components/chart-panel.js';
import {
    analyzeSession,
} from '../../bio/bio-math-engine.js';
import * as healthConnect from '../../bio/health-connect-service.js';
import {
    buildSessionSummary,
    formatHeartRateDelta,
} from '../session-language.js';

let _storage = null;
const _activeCharts = [];

export function shouldShowWatchEvidenceCharts(session, telemetry) {
    return session?.telemetrySource === 'health_connect'
        && Array.isArray(telemetry?.hr)
        && telemetry.hr.length > 0;
}

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

    const date = getSessionReferenceDate(session);
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

    const showEvidenceCharts = shouldShowWatchEvidenceCharts(session, telemetry);

    container.innerHTML = `
        <div class="view-header">
            <button class="back-btn" id="sessionBackBtn">← Back</button>
            <h2 class="view-title">Session</h2>
        </div>

        <div class="session-meta">
            <div class="session-date">${dateStr} · ${timeStr}</div>
            <div class="session-duration">${formatDuration(session.duration)}</div>
        </div>

        ${_insightsCard(insights, session, telemetry)}

        ${telemetry ? _evidencePanel(telemetry, insights, session, showEvidenceCharts) : ''}
    `;

    document.getElementById('sessionBackBtn')?.addEventListener('click', () => {
        navigateTo('history');
    });

    if (telemetry && showEvidenceCharts) {
        _mountEvidencePanel(container, telemetry, insights);
    }

    // Always show "Update Health Connect" on native — lets user pull fresh/additional data
    if (window.Capacitor?.isNativePlatform?.()) {
        _addHCUpdateButton(container, session, telemetry);
    }
}

function _mountEvidencePanel(container, telemetry, insights) {
    const panel = container.querySelector('.evidence-panel');
    if (!panel) return;

    const mountCharts = async () => {
        if (panel.dataset.chartsMounted === '1') return;
        await _renderCharts(container, telemetry, insights);
        panel.dataset.chartsMounted = '1';
    };

    panel.addEventListener('toggle', () => {
        if (panel.open) {
            mountCharts().catch((err) => console.error('[charts] failed to mount', err));
        }
    });

    if (panel.open) {
        mountCharts().catch((err) => console.error('[charts] failed to mount', err));
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
    const { hr = [], spo2 = [] } = telemetry;

    // Use the first HR sample as the session start anchor for elapsed-time x-axis
    const startMs = hr.length ? new Date(hr[0].timestamp).getTime() : 0;
    const toElapsed = (isoStr) => (new Date(isoStr).getTime() - startMs) / 1000;

    const hrData   = hr.map((p) => ({ x: toElapsed(p.timestamp), y: p.value }));
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

function _insightsCard(insights, session, telemetry) {
    if (!insights) {
        return `
            <div class="summary-card">
                <h3 class="card-heading">Session Note</h3>
                <p class="empty-state">No bio-data for this session.</p>
            </div>
        `;
    }

    const isHC = session?.telemetrySource === 'health_connect';
    const sourceBadge = session?.telemetrySource
        ? `<span class="source-badge ${isHC ? 'source-badge--hc' : 'source-badge--mock'}">${isHC ? 'Health Connect' : 'Mock Data'}</span>`
        : '';
    const summary = buildSessionSummary({ hr: telemetry?.hr || [], insights });

    return `
        <div class="summary-card session-summary-card">
            <h3 class="card-heading">Session Note ${sourceBadge}</h3>
            <div class="insight-grid insight-grid--summary">
                <div class="insight-item">
                    <span class="insight-label">Settle Time</span>
                    <span class="insight-value">${insights.settleTime ? formatDuration(insights.settleTime.seconds) : '—'}</span>
                </div>
                <div class="insight-item">
                    <span class="insight-label">HR Change</span>
                    <span class="insight-value">${summary.delta != null ? formatHeartRateDelta(summary.delta) : '—'}</span>
                </div>
            </div>
            <p class="session-summary-copy">${escapeHtml(summary.description)}</p>
        </div>
    `;
}

function _evidencePanel(telemetry, insights, session, showEvidenceCharts) {
    const summary = buildSessionSummary({ hr: telemetry?.hr || [], insights });

    return `
        <details class="evidence-panel" open>
            <summary class="card-heading">See Session Evidence</summary>
            <div class="evidence-summary-grid">
                <div class="evidence-stat">
                    <span class="insight-label">Avg HR</span>
                    <span class="insight-value">${insights.avgHR != null ? `${insights.avgHR} bpm` : '—'}</span>
                </div>
                <div class="evidence-stat">
                    <span class="insight-label">Lowest HR</span>
                    <span class="insight-value">${insights.minHR != null ? `${insights.minHR} bpm` : '—'}</span>
                </div>
                <div class="evidence-stat">
                    <span class="insight-label">HR Change</span>
                    <span class="insight-value">${summary.delta != null ? formatHeartRateDelta(summary.delta) : '—'}</span>
                </div>
            </div>
            ${showEvidenceCharts ? _chartSectionHTML(insights) : ''}
            ${_diagnosticsPanel(telemetry, insights, session)}
        </details>
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
