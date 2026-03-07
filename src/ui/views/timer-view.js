// timer-view.js — Timer screen: display, controls, mini stats, recent sessions

import { formatTime, formatDuration, formatHeaderDate, isSameDay, getWeekStart } from '../../utils/date-helpers.js';
import { startTimer, pauseTimer, finishTimer, isRunning, onTick, onSessionSave } from '../../timer/timer.js';
import { navigateTo } from '../router.js';
import { analyzeSession } from '../../bio/bio-math-engine.js';
import { PROFILE_DEEP } from '../../bio/mock-data.js';
import * as healthConnect from '../../bio/health-connect-service.js';

let _storage = null;
let _timerDisplay = null;
let _startBtn = null;
let _pauseBtn = null;
let _finishBtn = null;
let _historyList = null;
let _statToday = null;
let _statWeek = null;
let _statMonth = null;
let _headerDate = null;
let _dateInterval = null;

export function mountTimerView(storage) {
    _storage = storage;

    _timerDisplay = document.getElementById('timer');
    _startBtn     = document.getElementById('startBtn');
    _pauseBtn     = document.getElementById('pauseBtn');
    _finishBtn    = document.getElementById('resetBtn');
    _historyList  = document.getElementById('historyList');
    _statToday    = document.getElementById('statToday');
    _statWeek     = document.getElementById('statWeek');
    _statMonth    = document.getElementById('statMonth');
    _headerDate   = document.getElementById('headerDate');

    onTick(_handleTick);
    onSessionSave(_handleSessionSave);

    _startBtn.addEventListener('click', _onStart);
    _pauseBtn.addEventListener('click', _onPause);
    _finishBtn.addEventListener('click', _onFinish);

    _updateHeaderDate();
    _dateInterval = setInterval(_updateHeaderDate, 1000);

    _updateTimerDisplay(0);
    renderHistory();
    renderStats();

    // Phase 6: one-time banner if Health Connect not installed
    if (window.Capacitor?.isNativePlatform?.()) _checkHCAvailabilityOnce();
}

function _handleTick(elapsed) {
    _updateTimerDisplay(elapsed);
}

async function _handleSessionSave({ duration, startTimestamp, endTimestamp }) {
    const session = {
        id: `ses_${Date.now()}`,
        startTimestamp,
        endTimestamp,
        duration,
        hasTelemetry: false,
        insights: null,
        type: 'meditation',
        schemaVersion: 2,
    };
    await _storage.saveSession(session);

    // Attach telemetry: real HC data on native, mock fallback on web
    await _attachTelemetry(session).catch((err) =>
        console.warn('[telemetry] Failed to attach:', err)
    );

    renderHistory();
    renderStats();
}

async function _attachTelemetry(session) {
    if (window.Capacitor?.isNativePlatform?.()) {
        await _attachHCTelemetry(session);
    } else {
        await _attachMockTelemetry(session);
    }
}

async function _attachMockTelemetry(session) {
    const telemetry = _remapTelemetry(PROFILE_DEEP, session.startTimestamp);
    const insights  = analyzeSession(telemetry);
    await _storage.saveTelemetry(session.id, telemetry);
    session.hasTelemetry = true;
    session.insights = insights;
    await _storage.saveSession(session);
}

async function _attachHCTelemetry(session) {
    const availability = await healthConnect.checkAvailability();
    if (availability !== 'available') {
        if (availability === 'notInstalled' && !localStorage.getItem('hc_banner_shown')) {
            _showHCBanner();
            localStorage.setItem('hc_banner_shown', '1');
        }
        await _attachMockTelemetry(session);
        return;
    }

    // Skip if user previously chose not to grant permissions
    if (localStorage.getItem('hc_permission_declined')) {
        await _attachMockTelemetry(session);
        return;
    }

    let { granted } = await healthConnect.checkPermissions();
    if (!granted) {
        const allowed = await _showHCPermissionModal();
        if (!allowed) {
            localStorage.setItem('hc_permission_declined', '1');
            await _attachMockTelemetry(session);
            return;
        }
        ({ granted } = await healthConnect.requestPermissions());
        if (!granted) {
            await _attachMockTelemetry(session);
            return;
        }
    }

    _setHCStatus('Fetching health data…');
    try {
        const telemetry = await healthConnect.querySession(session.startTimestamp, session.endTimestamp);
        if (!telemetry.hr?.length) {
            await _attachMockTelemetry(session);
            return;
        }
        const insights = analyzeSession(telemetry);
        await _storage.saveTelemetry(session.id, telemetry);
        session.hasTelemetry = true;
        session.insights = insights;
        await _storage.saveSession(session);
    } finally {
        _setHCStatus('');
    }
}

/** Remap PROFILE_DEEP timestamps to the actual session start time. */
function _remapTelemetry(profile, startTimestamp) {
    const offset = new Date(startTimestamp).getTime() - new Date(profile.hr[0].timestamp).getTime();
    const shift  = (s) => s.map((p) => ({
        ...p,
        timestamp: new Date(new Date(p.timestamp).getTime() + offset).toISOString(),
    }));
    return {
        hr:   shift(profile.hr),
        hrv:  shift(profile.hrv),
        temp: shift(profile.temp),
        spo2: shift(profile.spo2),
        source: 'mock',
    };
}

// ── HC UI helpers ──────────────────────────────────────────────────────────

let _hcStatusEl = null;

function _setHCStatus(msg) {
    if (!msg) { _hcStatusEl?.remove(); _hcStatusEl = null; return; }
    if (!_hcStatusEl) {
        _hcStatusEl = document.createElement('div');
        _hcStatusEl.className = 'hc-status';
        document.querySelector('.controls')?.after(_hcStatusEl);
    }
    _hcStatusEl.textContent = msg;
}

function _showHCBanner() {
    if (document.querySelector('.hc-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'hc-banner';
    banner.innerHTML = `
        <span>Install Health Connect for bio insights</span>
        <button class="hc-banner-dismiss" aria-label="Dismiss">✕</button>
    `;
    document.querySelector('.dashboard')?.before(banner);
    banner.querySelector('.hc-banner-dismiss').addEventListener('click', () => banner.remove());
}

function _showHCPermissionModal() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'hc-modal-overlay';
        overlay.innerHTML = `
            <div class="hc-modal">
                <p class="hc-modal-msg">Allow Health Connect access to capture heart rate and SpO&#x2082; for this session?</p>
                <div class="hc-modal-btns">
                    <button class="btn secondary hc-skip">Skip</button>
                    <button class="btn primary hc-allow">Allow</button>
                </div>
            </div>
        `;
        document.getElementById('app').appendChild(overlay);
        overlay.querySelector('.hc-allow').addEventListener('click', () => { overlay.remove(); resolve(true); });
        overlay.querySelector('.hc-skip').addEventListener('click', () => { overlay.remove(); resolve(false); });
    });
}

async function _checkHCAvailabilityOnce() {
    if (localStorage.getItem('hc_banner_shown')) return;
    const availability = await healthConnect.checkAvailability().catch(() => 'notSupported');
    if (availability === 'notInstalled') {
        _showHCBanner();
        localStorage.setItem('hc_banner_shown', '1');
    }
}

function _onStart() {
    startTimer();
    _startBtn.disabled = true;
    _pauseBtn.disabled = false;
    _finishBtn.disabled = false;
}

function _onPause() {
    if (isRunning()) {
        pauseTimer();
        _startBtn.disabled = false;
        _pauseBtn.disabled = true;
    } else {
        startTimer();
        _startBtn.disabled = true;
        _pauseBtn.disabled = false;
    }
}

function _onFinish() {
    finishTimer();
    _startBtn.disabled = false;
    _pauseBtn.disabled = true;
    _updateTimerDisplay(0);
}

function _updateTimerDisplay(elapsed) {
    if (_timerDisplay) {
        _timerDisplay.textContent = formatTime(elapsed);
        document.title = `${formatTime(elapsed)} — Meditation`;
    }
}

function _updateHeaderDate() {
    if (_headerDate) {
        _headerDate.textContent = formatHeaderDate(new Date());
    }
}

export async function renderHistory() {
    if (!_historyList || !_storage) return;

    const sessions = await _storage.getAllSessions();
    const recent = sessions.slice(0, 3);

    _historyList.innerHTML = '';
    if (recent.length === 0) {
        _historyList.innerHTML = '<li class="empty-state">No sessions yet</li>';
        return;
    }

    recent.forEach((session) => {
        const dateStr = session.endTimestamp || session.startTimestamp;
        const date = new Date(dateStr);
        const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateString = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const qualityBadge = session.insights?.sessionQuality
            ? ` <span class="quality-badge quality-badge--${session.insights.sessionQuality}">${_qualityLabel(session.insights.sessionQuality)}</span>`
            : '';

        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
            <span>Meditation (${formatDuration(session.duration)})${qualityBadge}</span>
            <span class="history-time">${dateString}, ${timeString}</span>
        `;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => navigateTo('session', [session.id]));
        _historyList.appendChild(li);
    });
}

export async function renderStats() {
    if (!_storage) return;

    const sessions = await _storage.getAllSessions();
    const now = new Date();
    const weekStart = getWeekStart(now);

    let todaySecs = 0, weekSecs = 0, monthSecs = 0;
    sessions.forEach((s) => {
        const d = new Date(s.endTimestamp || s.startTimestamp);
        if (isSameDay(d, now)) todaySecs += s.duration;
        if (d >= weekStart) weekSecs += s.duration;
        if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
            monthSecs += s.duration;
        }
    });

    if (_statToday) _statToday.textContent = formatDuration(todaySecs);
    if (_statWeek)  _statWeek.textContent  = formatDuration(weekSecs);
    if (_statMonth) _statMonth.textContent = formatDuration(monthSecs);
}

function _qualityLabel(quality) {
    const map = {
        restless: 'Restless', settling: 'Settling', absorbed: 'Absorbed',
        deep_absorption: 'Deep', somnolent: 'Drowsy',
    };
    return map[quality] || quality;
}
