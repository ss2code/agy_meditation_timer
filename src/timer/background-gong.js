// background-gong.js — Local notification scheduling for gong events.
//
// v8 REWRITE — fundamentals changed:
//
//   STATIC IMPORT of @capacitor/local-notifications. The previous dynamic
//   import (`await import(...)`) hung on certain Android WebViews, blocking
//   all notification scheduling for the entire session. Static imports are
//   resolved at bundle time by Vite — no async, no hanging.
//
//   CHANNEL CREATION: attempted at boot AND verified before scheduling.
//   Channels persist across app restarts on Android. On Android 8+, if a
//   notification references a channel that doesn't exist, the notification
//   is SILENTLY DROPPED — no sound, no display. So we MUST ensure channels
//   exist before any notification fires. The localStorage flag tracks this.
//
//   MULTI-STRIKE THROTTLE: Android's setExactAndAllowWhileIdle() (used by
//   the Capacitor plugin) has a 9-minute per-app throttle in Doze mode.
//   Multi-strike gongs (2+ strikes 7s apart) will only play the first strike
//   while backgrounded. This is an OS limitation, not a bug.
//
// On web (non-Capacitor), all exported functions are silent no-ops.

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';

const isNative = Capacitor.isNativePlatform();

const CHANNEL_ID_GONG    = 'gong';        // custom gong.wav sound
const CHANNEL_ID_DEFAULT = 'gong_diag';   // Android system default chime
const NOTIF_SOUND        = 'gong';        // matches res/raw/gong.wav
const STRIKE_GAP_SEC     = 7;
const MAX_SESSION_SEC    = 7200;

// ── Runtime config (persisted in localStorage) ────────────────────────────

const CONFIG_KEY = 'gong_config';

function _getConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch (_) { return {}; }
}

/** Get the currently configured gong interval in seconds (300 or 900). */
export function getGongIntervalSec() {
    const val = _getConfig().intervalSec;
    if (val === 120) return 300; // migrate old 2-min setting
    return val ?? 900; // default 15 min
}

export function setGongIntervalSec(sec) {
    const cfg = _getConfig();
    cfg.intervalSec = sec;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    _log(`Gong interval → ${sec}s (${sec === 900 ? '15 min' : '5 min'})`);
}

/** Whether to use the Android system default chime (true) or custom gong.wav (false). */
export function getUseDefaultSound() {
    return _getConfig().useDefaultSound ?? false;
}

export function setUseDefaultSound(useDefault) {
    const cfg = _getConfig();
    cfg.useDefaultSound = useDefault;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    _log(`Sound → ${useDefault ? 'Android system chime' : 'custom gong.wav'}`);
}

// ── On-device diagnostic logging ─────────────────────────────────────────

const LOG_KEY = 'gong_debug_log';
const MAX_LOG_ENTRIES = 200;

function _log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = `[${ts}] ${msg}`;
    console.log(`[bg-gong] ${entry}`);
    try {
        const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        logs.push(entry);
        if (logs.length > MAX_LOG_ENTRIES) logs.splice(0, logs.length - MAX_LOG_ENTRIES);
        localStorage.setItem(LOG_KEY, JSON.stringify(logs));
    } catch (_) { /* storage full */ }
}

export function getDiagnosticLogs() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (_) { return []; }
}

export function clearDiagnosticLogs() {
    localStorage.removeItem(LOG_KEY);
}

// ── Notification delivery listener (registered once at module load) ──────

if (isNative) {
    try {
        LocalNotifications.addListener('localNotificationReceived', (notif) => {
            _log(`NOTIF DELIVERED #${notif.id}: "${notif.body}"`);
        });
    } catch (_) { /* ignore on web */ }
}

// ── Channel creation (once ever, persisted) ──────────────────────────────

const CHANNELS_KEY = 'gong_channels_v2';

async function _createChannels() {
    await LocalNotifications.createChannel({
        id: CHANNEL_ID_GONG,
        name: 'Meditation Gong',
        description: 'Custom gong sound for meditation intervals',
        importance: 5,
        sound: NOTIF_SOUND,
        vibration: false,
    });
    await LocalNotifications.createChannel({
        id: CHANNEL_ID_DEFAULT,
        name: 'Meditation Gong (Chime)',
        description: 'Android system default chime',
        importance: 5,
        vibration: true,
    });
    localStorage.setItem(CHANNELS_KEY, '1');
}

/**
 * Ensure notification channels exist. Called at boot and before each schedule.
 * Channels persist across app restarts on Android — we only create once and
 * track via localStorage. If creation times out, we'll retry next time.
 */
async function _ensureChannels() {
    if (localStorage.getItem(CHANNELS_KEY) === '1') return;

    _log('Creating notification channels...');
    try {
        await Promise.race([
            _createChannels(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 5s')), 5000)),
        ]);
        _log('Channels created ✓');
    } catch (e) {
        _log(`Channel creation failed: ${e.message} — notifications may be silent`);
    }
}

/**
 * Called at app boot (from main.js). Creates notification channels and
 * requests permissions. Both are best-effort with timeouts.
 */
export async function initBackgroundGongs() {
    if (!isNative) return;
    _log('initBackgroundGongs()');

    await _ensureChannels();

    // Best-effort permission request
    try {
        const { display } = await Promise.race([
            LocalNotifications.checkPermissions(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]);
        _log(`Permission: ${display}`);
        if (display !== 'granted') {
            const result = await LocalNotifications.requestPermissions();
            _log(`Permission request → ${result.display}`);
        }
    } catch (e) {
        _log(`Permission check skipped: ${e.message}`);
    }
}

// ── Gong schedule computation (pure function — used by tests) ────────────

/**
 * Compute the flat list of notification entries for all future gong events.
 * Uses the runtime-configured interval (getGongIntervalSec()).
 */
export function computeGongSchedule(elapsedSec, nowMs) {
    const interval = getGongIntervalSec();
    const entries = [];
    let id = 1;

    // Settling gong at t=15
    if (15 > elapsedSec) {
        entries.push({ id: id++, fireAt: new Date(nowMs + (15 - elapsedSec) * 1000) });
    }

    // Interval gongs
    for (let t = interval; t <= MAX_SESSION_SEC; t += interval) {
        if (t <= elapsedSec) continue;
        const strikes = t / interval;
        const baseMsFromNow = (t - elapsedSec) * 1000;
        for (let k = 0; k < strikes; k++) {
            entries.push({ id: id++, fireAt: new Date(nowMs + baseMsFromNow + k * STRIKE_GAP_SEC * 1000) });
        }
    }

    return entries;
}

// ── Scheduling ───────────────────────────────────────────────────────────

let _scheduledIds = [];

/**
 * Schedule local notifications for all future gong events.
 *
 * Ensures notification channels exist before scheduling. On Android 8+,
 * a notification referencing a missing channel is silently dropped — the
 * alarm fires but nothing displays and no sound plays. We check the
 * localStorage flag and create channels inline if needed (3s timeout).
 */
export async function scheduleBackgroundGongs(elapsedSec, caller = 'unknown') {
    if (!isNative) return;

    _log(`schedule(${elapsedSec}s) by:${caller}`);

    // CRITICAL: Ensure channels exist. Without channels, notifications are
    // silently dropped when the alarm fires — no sound, no display.
    await _ensureChannels();

    // Cancel any previously scheduled notifications
    await cancelBackgroundGongs('pre-schedule');

    const nowMs = Date.now();
    const schedule = computeGongSchedule(elapsedSec, nowMs);
    if (schedule.length === 0) { _log('No future gongs to schedule'); return; }

    const useDefault = getUseDefaultSound();
    const channelId  = useDefault ? CHANNEL_ID_DEFAULT : CHANNEL_ID_GONG;
    const soundLabel = useDefault ? 'system chime' : 'gong.wav';

    const notifications = schedule.map(e => ({
        id: e.id,
        title: 'Meditation',
        body: `Gong #${e.id}`,
        schedule: { at: e.fireAt, allowWhileIdle: true },
        sound: useDefault ? undefined : NOTIF_SOUND,
        channelId,
        smallIcon: 'ic_launcher_foreground',
        autoCancel: true,
    }));

    // Log timing info
    const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const first = schedule[0].fireAt;
    const last  = schedule[schedule.length - 1].fireAt;
    _log(`${notifications.length} notifs | sound:${soundLabel} | first at ${fmtTime(first)} (in ${Math.round((first - nowMs) / 1000)}s) | last at ${fmtTime(last)}`);

    try {
        await LocalNotifications.schedule({ notifications });
        _scheduledIds = notifications.map(n => n.id);
        _log(`schedule SUCCESS — ${_scheduledIds.length} total`);

        // Verify
        const { notifications: pending } = await LocalNotifications.getPending();
        _log(`VERIFY: ${pending.length} pending in system`);
        if (pending.length === 0) {
            _log('⚠ ZERO pending — Android may have rejected. Channels created: ' + (localStorage.getItem(CHANNELS_KEY) === '1'));
        }
    } catch (err) {
        _log(`schedule FAILED: ${err.message || err}`);
    }
}

export async function cancelBackgroundGongs(caller = 'unknown') {
    if (!isNative || _scheduledIds.length === 0) return;

    _log(`cancel(${_scheduledIds.length}) by:${caller}`);
    try {
        await LocalNotifications.cancel({ notifications: _scheduledIds.map(id => ({ id })) });
        _log('cancel SUCCESS');
    } catch (err) {
        _log(`cancel FAILED: ${err.message || err}`);
    }
    _scheduledIds = [];
}

// ── Foreground Service ───────────────────────────────────────────────────

export async function startMeditationForegroundService() {
    if (!isNative) return;
    try {
        await ForegroundService.startForegroundService({
            id: 100, // Unique ID for the persistent notification
            title: 'Meditation in Progress',
            body: 'Timer is running and background gongs are scheduled.',
            smallIcon: 'ic_launcher_foreground',
        });
        _log('Foreground Service started');
    } catch (e) {
        _log(`Foreground Service start failed: ${e.message || e}`);
    }
}

export async function stopMeditationForegroundService() {
    if (!isNative) return;
    try {
        await ForegroundService.stopForegroundService();
        _log('Foreground Service stopped');
    } catch (e) {
        _log(`Foreground Service stop failed: ${e.message || e}`);
    }
}

// ── Exact alarm permission (UI banner) ───────────────────────────────────

export async function checkExactAlarmPermission() {
    if (!isNative) return true;
    try {
        const result = await Promise.race([
            LocalNotifications.checkExactNotificationSetting(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]);
        _log(`exactAlarm: ${result.exact_alarm}`);
        return result.exact_alarm === 'granted';
    } catch (e) {
        _log(`exactAlarm check skipped: ${e.message}`);
        return true; // assume granted if we can't check
    }
}

export async function requestExactAlarmSetting() {
    if (!isNative) return;
    try {
        await LocalNotifications.changeExactNotificationSetting();
    } catch (e) {
        console.warn('[background-gong] changeExactNotificationSetting failed:', e);
    }
}
