// timer-view.js — Timer screen: display, controls, mini stats, recent sessions

import { formatTime, formatDuration, formatHeaderDate, isSameDay, getWeekStart, getLast7DaysCounts } from '../../utils/date-helpers.js';
import { startTimer, pauseTimer, finishTimer, isRunning, onTick, onSessionSave, sessionStartTimestamp } from '../../timer/timer.js';
import { navigateTo } from '../router.js';
import { analyzeSession } from '../../bio/bio-math-engine.js';
import { generateMockTelemetry } from '../../bio/mock-data.js';
import * as healthConnect from '../../bio/health-connect-service.js';
import { checkExactAlarmPermission, requestExactAlarmSetting, scheduleBackgroundGongs } from '../../timer/background-gong.js';

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

async function _attachMockTelemetry(session, reason = 'Web browser') {
    const startMs   = new Date(session.startTimestamp).getTime();
    const telemetry = generateMockTelemetry(startMs, session.duration);
    const insights  = analyzeSession(telemetry);
    // Strip session quality from mock data — it would be misleading
    insights.sessionQuality = null;
    await _storage.saveTelemetry(session.id, telemetry);
    session.hasTelemetry = true;
    session.insights = insights;
    session.telemetrySource = 'mock';
    session.telemetryReason = reason;
    await _storage.saveSession(session);
    console.log('[telemetry] Mock data attached. Reason:', reason);
    _showTelemetryToast('Mock Data', reason);
}

async function _attachHCTelemetry(session) {
    console.log('[HC] Starting telemetry acquisition…');

    const availability = await healthConnect.checkAvailability();
    console.log('[HC] availability:', availability);
    if (availability !== 'available') {
        const reason = availability === 'notInstalled' ? 'HC not installed' : 'HC not supported';
        if (availability === 'notInstalled' && !localStorage.getItem('hc_banner_shown')) {
            _showHCBanner();
            localStorage.setItem('hc_banner_shown', '1');
        }
        await _attachMockTelemetry(session, reason);
        return;
    }

    let { granted, missing } = await healthConnect.checkPermissions();
    console.log('[HC] checkPermissions:', JSON.stringify({ granted, missing }));

    if (!granted) {
        const allowed = await _showHCPermissionModal();
        if (!allowed) {
            console.log('[HC] User skipped permissions for this session');
            await _attachMockTelemetry(session, 'Permissions skipped');
            return;
        }
        ({ granted, missing } = await healthConnect.requestPermissions());
        console.log('[HC] requestPermissions result:', JSON.stringify({ granted, missing }));
        if (!granted) {
            await _attachMockTelemetry(session, `Permissions denied: ${missing.join(', ')}`);
            return;
        }
    }

    // Poll HC with retries — wearables sync data on ~15 min intervals
    const MAX_ATTEMPTS = 8;
    const POLL_INTERVAL = 15_000;
    const { overlay, statusEl, cancelPromise } = _showHCSyncOverlay();
    let cancelled = false;
    cancelPromise.then(() => { cancelled = true; });

    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (cancelled) break;

            statusEl.textContent = `Waiting for watch sync… (${attempt}/${MAX_ATTEMPTS})`;
            console.log(`[HC] Query attempt ${attempt}/${MAX_ATTEMPTS}…`);

            const telemetry = await healthConnect.querySession(session.startTimestamp, session.endTimestamp);
            console.log(`[HC] Attempt ${attempt} — HR: ${telemetry.hr?.length}, HRV: ${telemetry.hrv?.length},`,
                `SpO2: ${telemetry.spo2?.length}, Resp: ${telemetry.resp?.length}`);

            if (telemetry.hr?.length) {
                overlay.remove();
                const insights = analyzeSession(telemetry);
                await _storage.saveTelemetry(session.id, telemetry);
                session.hasTelemetry = true;
                session.insights = insights;
                session.telemetrySource = 'health_connect';
                session.telemetryReason = `HR: ${telemetry.hr.length}, HRV: ${telemetry.hrv?.length || 0}, SpO2: ${telemetry.spo2?.length || 0}`;
                await _storage.saveSession(session);
                console.log('[HC] Telemetry attached successfully');
                _showTelemetryToast('Health Connect', session.telemetryReason);
                return;
            }

            if (attempt < MAX_ATTEMPTS && !cancelled) {
                await Promise.race([_delay(POLL_INTERVAL), cancelPromise]);
            }
        }

        overlay.remove();
        await _attachMockTelemetry(session, 'No HR data from Health Connect');
    } catch (err) {
        overlay.remove();
        throw err;
    }
}

function _delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── HC UI helpers ──────────────────────────────────────────────────────────

function _showHCSyncOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'hc-sync-overlay';

    let resolveCancel;
    const cancelPromise = new Promise((r) => { resolveCancel = r; });

    const statusEl = document.createElement('div');
    statusEl.className = 'hc-sync-status';
    statusEl.textContent = 'Connecting to Health Connect…';

    const hint = document.createElement('div');
    hint.className = 'hc-sync-hint';
    hint.textContent = 'Open your wearable app to force a sync';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn secondary hc-sync-skip';
    skipBtn.textContent = 'Skip — Use Mock Data';
    skipBtn.addEventListener('click', () => resolveCancel());

    overlay.append(statusEl, hint, skipBtn);
    document.querySelector('.controls')?.after(overlay);

    return { overlay, statusEl, cancelPromise };
}

function _showTelemetryToast(source, reason) {
    const toast = document.createElement('div');
    toast.className = `telemetry-toast telemetry-toast--${source === 'Health Connect' ? 'hc' : 'mock'}`;
    toast.textContent = `${source}: ${reason}`;
    document.getElementById('app')?.appendChild(toast);
    setTimeout(() => { toast.classList.add('telemetry-toast--fade'); }, 3000);
    setTimeout(() => toast.remove(), 3600);
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

async function _onStart() {
    startTimer();
    _startBtn.disabled = true;
    _pauseBtn.disabled = false;
    _finishBtn.disabled = false;

    // Freeze header to show session start time
    clearInterval(_dateInterval);
    _dateInterval = null;
    _showStartTime();

    // Schedule gongs — uses static import, no plugin loading to hang.
    // initBackgroundGongs() already ran at boot (main.js).
    // Await is safe here: user just tapped Start, app is in foreground,
    // and all async ops are native bridge calls with timeouts.
    await scheduleBackgroundGongs(0, 'sessionStart');

    // Best-effort exact alarm banner
    _checkExactAlarmOnce();
}

async function _checkExactAlarmOnce() {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    if (document.querySelector('.exact-alarm-banner')) return;
    const granted = await checkExactAlarmPermission();
    if (granted) return;

    const banner = document.createElement('div');
    banner.className = 'exact-alarm-banner';
    banner.innerHTML = `
        <span>Gongs need Alarms &amp; Reminders permission to fire while screen is off.</span>
        <div class="exact-alarm-banner-actions">
            <button class="exact-alarm-fix">Fix</button>
            <button class="exact-alarm-dismiss">✕</button>
        </div>
    `;
    document.getElementById('app')?.prepend(banner);
    banner.querySelector('.exact-alarm-fix').addEventListener('click', async () => {
        banner.remove();
        await requestExactAlarmSetting();
    });
    banner.querySelector('.exact-alarm-dismiss').addEventListener('click', () => banner.remove());
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

    // Resume live clock in header
    _updateHeaderDate();
    _dateInterval = setInterval(_updateHeaderDate, 1000);
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

function _showStartTime() {
    if (_headerDate && sessionStartTimestamp) {
        const d = new Date(sessionStartTimestamp);
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        _headerDate.textContent = `Started at ${time}`;
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

    const weekDotsEl = document.getElementById('weekDots');
    if (weekDotsEl) {
        const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        const dots = getLast7DaysCounts(sessions);
        weekDotsEl.innerHTML = `<div class="week-dots">${
            dots.map(({ count, isToday }, i) => {
                const state = count === 0 ? '' : count === 1 ? ' week-dot--half' : ' week-dot--full';
                const today = isToday ? ' week-dot--today' : '';
                return `<div class="week-dot-col">
                    <span class="week-dot${state}${today}"></span>
                    <span class="week-dot-label${isToday ? ' week-dot-label--today' : ''}">${DAY_LABELS[i]}</span>
                </div>`;
            }).join('')
        }</div>`;
    }
}

function _qualityLabel(quality) {
    const map = {
        restless: 'Restless', settling: 'Settling', absorbed: 'Absorbed',
        deep_absorption: 'Deep', somnolent: 'Drowsy',
    };
    return map[quality] || quality;
}
