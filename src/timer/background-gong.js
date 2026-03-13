// background-gong.js — Local notification scheduling for gong events.
//
// DIAGNOSTIC BUILD — Two independent sound mechanisms run simultaneously:
//   1. Web Audio (gong.js)     → synthesized metallic gong, foreground only
//   2. Android notification    → configurable sound (gong.wav or system chime)
//
// Runtime-configurable via Dev Debug panel (persisted in localStorage):
//   - Interval: 2 min (testing) or 15 min (production)
//   - Sound: custom gong.wav or Android system default chime
//
// On web (non-Capacitor), all exported functions are silent no-ops.

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

/** Get the currently configured gong interval in seconds (120 or 900). */
export function getGongIntervalSec() {
    return _getConfig().intervalSec ?? 120; // default 2 min for diagnostic builds
}

export function setGongIntervalSec(sec) {
    const cfg = _getConfig();
    cfg.intervalSec = sec;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    _log(`Gong interval → ${sec}s (${sec === 900 ? '15 min' : '2 min'})`);
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

// ── On-device diagnostic logging (no USB needed) ──────────────────────────

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
    } catch (_) { /* storage full — ignore */ }
}

export function getDiagnosticLogs() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (_) { return []; }
}

export function clearDiagnosticLogs() {
    localStorage.removeItem(LOG_KEY);
}

// ── Plugin init ───────────────────────────────────────────────────────────

let _plugin = null;

async function _getPlugin() {
    if (typeof window === 'undefined' || !window.Capacitor?.isNativePlatform?.()) return null;
    if (_plugin) return _plugin;

    try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        // Create both channels so we can switch at runtime without reinstalling
        await LocalNotifications.createChannel({
            id: CHANNEL_ID_GONG,
            name: 'Meditation Gong',
            description: 'Custom gong sound',
            importance: 5,
            sound: NOTIF_SOUND,
            vibration: false,
        });
        await LocalNotifications.createChannel({
            id: CHANNEL_ID_DEFAULT,
            name: 'Meditation Gong (Chime)',
            description: 'Android system default chime',
            importance: 5,
            // no sound key → system default
            vibration: true,
        });
        _plugin = LocalNotifications;
        _log('Plugin loaded — channels: gong (gong.wav) + gong_diag (system chime)');
    } catch (e) {
        _log(`Plugin init FAILED: ${e.message || e}`);
    }
    return _plugin;
}

/**
 * Compute the flat list of notification entries for all future gong events.
 * Uses the runtime-configured interval (getGongIntervalSec()).
 */
export function computeGongSchedule(elapsedSec, nowMs) {
    const interval = getGongIntervalSec();
    const entries = [];
    let id = 1;

    if (15 > elapsedSec) {
        entries.push({ id: id++, fireAt: new Date(nowMs + (15 - elapsedSec) * 1000) });
    }

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

let _scheduledIds = [];
let _permissionGranted = false;

/**
 * Pre-load the plugin and check/request notification permission.
 * Must be called while the app is in the foreground.
 */
export async function initBackgroundGongs() {
    _log('initBackgroundGongs() called');
    const plugin = await _getPlugin();
    if (!plugin) { _log('No plugin — not native platform'); return false; }

    // Wrap Capacitor bridge calls in a timeout — on some devices these calls
    // hang indefinitely, blocking all scheduling.
    const withTimeout = (promise, ms, fallback, label) =>
        Promise.race([
            promise,
            new Promise(resolve =>
                setTimeout(() => { _log(`${label} timed out after ${ms}ms — assuming ${JSON.stringify(fallback)}`); resolve(fallback); }, ms)
            ),
        ]);

    // Check first — avoids triggering a dialog if already granted
    try {
        const { display } = await withTimeout(plugin.checkPermissions(), 2000, { display: 'granted' }, 'checkPermissions');
        _log(`checkPermissions → ${display}`);
        if (display === 'granted') {
            _permissionGranted = true;
            _log('Permission granted ✓');
            return true;
        }
    } catch (e) {
        _log(`checkPermissions error: ${e.message || e} — assuming granted`);
        _permissionGranted = true;
        return true;
    }

    // Not yet granted — request it
    try {
        _log('Calling requestPermissions()...');
        const { display } = await withTimeout(plugin.requestPermissions(), 4000, { display: 'granted' }, 'requestPermissions');
        _permissionGranted = display === 'granted';
        _log(`requestPermissions → ${display}  perm=${_permissionGranted}`);
    } catch (e) {
        _log(`requestPermissions FAILED: ${e.message || e} — assuming granted`);
        _permissionGranted = true;
    }
    return _permissionGranted;
}

/**
 * Schedule local notifications for all future gong events.
 * Sound channel chosen by runtime config (getUseDefaultSound()).
 */
export async function scheduleBackgroundGongs(elapsedSec, caller = 'unknown') {
    _log(`schedule(${elapsedSec}s) by:${caller}  plugin=${!!_plugin} perm=${_permissionGranted}`);
    if (!_plugin || !_permissionGranted) {
        _log(`schedule SKIPPED — plugin=${!!_plugin} perm=${_permissionGranted}`);
        return;
    }

    await cancelBackgroundGongs('pre-schedule');

    const schedule = computeGongSchedule(elapsedSec, Date.now());
    if (schedule.length === 0) { _log('No future gongs'); return; }

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
        ongoing: false,
        autoCancel: true,
    }));

    const firstFire = schedule[0].fireAt;
    _log(`Scheduling ${notifications.length} notifs | sound:${soundLabel} | first in ${Math.round((firstFire - Date.now()) / 1000)}s`);

    try {
        await _plugin.schedule({ notifications });
        _scheduledIds = schedule.map(e => e.id);
        _log(`schedule SUCCESS — ${_scheduledIds.length} registered`);
        await _verifyPending();
    } catch (err) {
        _log(`schedule FAILED: ${err.message || err}`);
    }
}

async function _verifyPending() {
    try {
        const { notifications } = await _plugin.getPending();
        _log(`VERIFY: ${notifications.length} pending in system`);
        if (notifications.length === 0) {
            _log('  ⚠ ZERO pending — Android may have rejected the schedule!');
        } else {
            _log(`  Next: id=${notifications[0].id}`);
        }
    } catch (err) {
        _log(`VERIFY failed: ${err.message || err}`);
    }
}

/**
 * Check SCHEDULE_EXACT_ALARM permission (Android 12+).
 * Logs but never throws — safe to call fire-and-forget.
 */
export async function checkExactAlarmPermission() {
    const plugin = await _getPlugin();
    if (!plugin) return true;
    try {
        const result = await plugin.checkExactNotificationSetting();
        _log(`exactAlarm: ${result.exact_alarm}`);
        return result.exact_alarm === 'granted';
    } catch (e) {
        _log(`checkExactNotificationSetting error (ignored): ${e.message || e}`);
        return true;
    }
}

export async function requestExactAlarmSetting() {
    const plugin = await _getPlugin();
    if (!plugin) return;
    try {
        await plugin.changeExactNotificationSetting();
    } catch (e) {
        console.warn('[background-gong] changeExactNotificationSetting failed:', e);
    }
}

export async function cancelBackgroundGongs(caller = 'unknown') {
    if (!_plugin || _scheduledIds.length === 0) return;

    _log(`cancel(${_scheduledIds.length}) by:${caller}`);
    try {
        await _plugin.cancel({ notifications: _scheduledIds.map(id => ({ id })) });
        _log('cancel SUCCESS');
    } catch (err) {
        _log(`cancel FAILED: ${err.message || err}`);
    }
    _scheduledIds = [];
}
