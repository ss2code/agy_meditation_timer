// insights-view.js — Longitudinal stats: weekly/monthly, streak, 30-day bar chart

import { formatDuration, getWeekStart, computeStreak, getLast30DaysData, getSessionReferenceDate } from '../../utils/date-helpers.js';
import { createChart, barChartConfig, lineChartConfig } from '../components/chart-panel.js';

let _storage = null;
let _dailyChart = null;
let _settleChart = null;

export function mountInsightsView(storage) {
    _storage = storage;
}

export async function renderInsightsView() {
    const container = document.getElementById('view-insights');
    if (!container || !_storage) return;

    if (_dailyChart) { _dailyChart.destroy(); _dailyChart = null; }
    if (_settleChart) { _settleChart.destroy(); _settleChart = null; }

    const sessions = await _storage.getAllSessions();
    const now = new Date();
    const weekStart = getWeekStart(now);

    // Weekly stats
    const weekSessions = sessions.filter(
        (s) => getSessionReferenceDate(s) >= weekStart
    );
    const weekTotal = weekSessions.reduce((sum, s) => sum + s.duration, 0);

    const weekWithSettle = weekSessions.filter((s) => s.insights?.settleTime?.seconds);
    const avgSettleTime = weekWithSettle.length
        ? Math.round(weekWithSettle.reduce((sum, s) => sum + s.insights.settleTime.seconds, 0) / weekWithSettle.length)
        : null;

    // Monthly stats
    const monthSessions = sessions.filter((s) => {
        const d = getSessionReferenceDate(s);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const monthTotal = monthSessions.reduce((sum, s) => sum + s.duration, 0);

    const streak = computeStreak(sessions);
    const { labels, data } = getLast30DaysData(sessions, 30);
    const hasAnyData = data.some((d) => d > 0);

    // Settle-time trend: sessions with bio data over the last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const settleData = sessions
        .filter((s) => {
            const d = getSessionReferenceDate(s);
            return d >= thirtyDaysAgo && s.insights?.settleTime?.seconds != null;
        })
        .map((s) => ({
            x: getSessionReferenceDate(s).toISOString(),
            y: parseFloat((s.insights.settleTime.seconds / 60).toFixed(1)),
        }))
        .sort((a, b) => new Date(a.x) - new Date(b.x));

    container.innerHTML = `
        <div class="view-header"><h2 class="view-title">Insights</h2></div>

        <div class="summary-card">
            <h3 class="card-heading">This Week</h3>
            <div class="stats-grid stats-grid--4">
                <div class="stat-item">
                    <span class="stat-label">Sessions</span>
                    <span class="stat-value">${weekSessions.length}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total</span>
                    <span class="stat-value">${formatDuration(weekTotal)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Avg Settle</span>
                    <span class="stat-value">${avgSettleTime ? formatDuration(avgSettleTime) : '—'}</span>
                </div>
                <div class="stat-item stat-item--accent">
                    <span class="stat-label">Streak</span>
                    <span class="stat-value">${streak > 0 ? `${streak}d` : '—'}</span>
                </div>
            </div>
        </div>

        <div class="summary-card">
            <h3 class="card-heading">30 Days · ${formatDuration(monthTotal)} this month</h3>
            ${hasAnyData
                ? '<div class="chart-canvas-wrap"><canvas id="daily-chart"></canvas></div>'
                : '<p class="empty-state">No sessions in the last 30 days.</p>'}
        </div>

        ${settleData.length >= 2 ? `
        <div class="summary-card">
            <h3 class="card-heading">Settle Time Trend · 30 Days</h3>
            <div class="chart-canvas-wrap"><canvas id="settle-chart"></canvas></div>
        </div>
        ` : ''}
    `;

    if (hasAnyData) {
        const canvas = container.querySelector('#daily-chart');
        if (canvas) {
            _dailyChart = await createChart(canvas, barChartConfig(labels, data, { yLabel: 'min' }));
        }
    }

    if (settleData.length >= 2) {
        const canvas = container.querySelector('#settle-chart');
        if (canvas) {
            _settleChart = await createChart(
                canvas,
                lineChartConfig('Settle (min)', settleData, { color: '#7E57C2', yLabel: 'min', fill: true })
            );
        }
    }
}
