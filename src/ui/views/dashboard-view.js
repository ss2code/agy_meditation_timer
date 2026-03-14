// dashboard-view.js — History list grouped by date

import { formatDuration, isSameDay } from '../../utils/date-helpers.js';
import { escapeHtml } from '../../utils/escape-html.js';
import { navigateTo } from '../router.js';

let _storage = null;
let _onDevPanelOpen = null;

export function mountDashboardView(storage, onDevPanelOpen) {
    _storage = storage;
    _onDevPanelOpen = onDevPanelOpen;
}

export async function renderDashboardView() {
    const container = document.getElementById('view-history');
    if (!container || !_storage) return;

    const sessions = await _storage.getAllSessions();

    if (sessions.length === 0) {
        container.innerHTML = `
            <div class="view-header"><h2 class="view-title">History</h2></div>
            <p class="empty-state">No sessions yet. Start meditating!</p>
        `;
        if (import.meta.env.DEV) _renderDevButton(container);
        return;
    }

    const groups = _groupByDate(sessions);

    let html = `<div class="view-header"><h2 class="view-title">History</h2></div>`;

    for (const { label, sessions: group } of groups) {
        html += `<div class="history-group"><h3 class="history-group-label">${label}</h3><ul class="history-list">`;
        group.forEach((session) => {
            const date = new Date(session.endTimestamp || session.startTimestamp);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const qualityBadge = session.insights?.sessionQuality
                ? `<span class="quality-badge quality-badge--${escapeHtml(session.insights.sessionQuality)}">${escapeHtml(_qualityLabel(session.insights.sessionQuality))}</span>`
                : '';
            html += `
                <li class="history-item history-item--clickable" data-id="${escapeHtml(session.id)}">
                    <div class="history-item__main">
                        <span class="history-item__duration">${formatDuration(session.duration)}</span>
                        ${qualityBadge}
                    </div>
                    <span class="history-time">${timeStr}</span>
                </li>
            `;
        });
        html += `</ul></div>`;
    }

    container.innerHTML = html;

    container.querySelectorAll('.history-item--clickable').forEach((el) => {
        el.addEventListener('click', () => navigateTo('session', [el.dataset.id]));
    });

    // Dev panel button — DEV builds only
    if (import.meta.env.DEV) _renderDevButton(container);
}

function _renderDevButton(container) {
    const btn = document.createElement('button');
    btn.className = 'dev-panel-open-btn';
    btn.textContent = '⚙ Dev Debug';
    btn.addEventListener('click', () => _onDevPanelOpen?.());
    container.appendChild(btn);
}

function _groupByDate(sessions) {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const map = new Map();
    sessions.forEach((s) => {
        const d = new Date(s.endTimestamp || s.startTimestamp);
        const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (!map.has(dayKey)) {
            let label;
            if (isSameDay(d, now))       label = 'Today';
            else if (isSameDay(d, yesterday)) label = 'Yesterday';
            else label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            map.set(dayKey, { label, sessions: [] });
        }
        map.get(dayKey).sessions.push(s);
    });

    return Array.from(map.values());
}

function _qualityLabel(quality) {
    const map = {
        restless: 'Restless', settling: 'Settling', absorbed: 'Absorbed',
        deep_absorption: 'Deep', somnolent: 'Drowsy',
    };
    return map[quality] || quality;
}
