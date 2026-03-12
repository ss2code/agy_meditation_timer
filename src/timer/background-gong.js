// background-gong.js — Local notification scheduling for gong events.
//
// Web Audio API is suspended by Android when the screen locks or the app
// backgrounds. This module schedules system-level local notifications so the
// gong sound fires reliably even when the app is not in the foreground.
//
// Strategy:
//   - When the app goes to background (visibilitychange → hidden), schedule
//     notifications for all future gong events in the current session.
//   - When the app returns to foreground (visibilitychange → visible), cancel
//     any remaining notifications so Web Audio handles them instead.
//   - On pause/finish, cancel all pending notifications.
//
// On web (non-Capacitor), all exported functions are silent no-ops.

const CHANNEL_ID      = 'gong';
const NOTIF_SOUND     = 'gong'; // matches android/app/src/main/res/raw/gong.wav
const STRIKE_GAP_SEC  = 7;      // seconds between strikes in a multi-strike gong
const MAX_SESSION_SEC = 7200;   // pre-schedule up to 2 hours

let _plugin = null;

async function _getPlugin() {
    if (typeof window === 'undefined' || !window.Capacitor?.isNativePlatform?.()) return null;
    if (_plugin) return _plugin;

    try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        // Create the notification channel required by Android 8+
        await LocalNotifications.createChannel({
            id: CHANNEL_ID,
            name: 'Meditation Gong',
            description: 'Gong intervals during meditation',
            importance: 5, // URGENT — ensures sound plays even in DND (user must allow)
            sound: NOTIF_SOUND,
            vibration: false,
        });
        _plugin = LocalNotifications;
    } catch (e) {
        console.warn('[background-gong] local-notifications unavailable:', e);
    }
    return _plugin;
}

/**
 * Compute the flat list of notification entries for all future gong events.
 *
 * Rules (same as timer.js _checkGongs):
 *   t = 15s  → 1 strike  (settling gong)
 *   t % 900 === 0 → N strikes where N = t / 900
 *
 * Each strike in a multi-strike event gets its own entry, spaced STRIKE_GAP_SEC apart.
 *
 * @param {number} elapsedSec  Seconds already elapsed at the moment of scheduling
 * @param {number} nowMs       Date.now() at the moment of scheduling
 * @returns {Array<{id: number, fireAt: Date}>}
 */
export function computeGongSchedule(elapsedSec, nowMs) {
    const entries = [];
    let id = 1;

    // Settling gong — 1 strike at t=15
    if (15 > elapsedSec) {
        entries.push({
            id: id++,
            fireAt: new Date(nowMs + (15 - elapsedSec) * 1000),
        });
    }

    // Interval gongs — N strikes at every 15-minute mark
    for (let t = 900; t <= MAX_SESSION_SEC; t += 900) {
        if (t <= elapsedSec) continue;
        const strikes = t / 900;
        const baseMsFromNow = (t - elapsedSec) * 1000;
        for (let k = 0; k < strikes; k++) {
            entries.push({
                id: id++,
                fireAt: new Date(nowMs + baseMsFromNow + k * STRIKE_GAP_SEC * 1000),
            });
        }
    }

    return entries;
}

let _scheduledIds = [];

/**
 * Schedule local notifications for all future gong events.
 * Silently no-ops on web.
 *
 * @param {number} elapsedSec Current session elapsed time in seconds
 */
export async function scheduleBackgroundGongs(elapsedSec) {
    const plugin = await _getPlugin();
    if (!plugin) return;

    await cancelBackgroundGongs();

    const { display } = await plugin.requestPermissions();
    if (display !== 'granted') return;

    const schedule = computeGongSchedule(elapsedSec, Date.now());
    if (schedule.length === 0) return;

    const notifications = schedule.map(e => ({
        id: e.id,
        title: 'Meditation',
        body: '',
        schedule: { at: e.fireAt, allowWhileIdle: true },
        sound: NOTIF_SOUND,
        channelId: CHANNEL_ID,
        smallIcon: 'ic_launcher_foreground',
        ongoing: false,
        autoCancel: true,
    }));

    await plugin.schedule({ notifications });
    _scheduledIds = schedule.map(e => e.id);
}

/**
 * Check whether the app can schedule exact alarms (requires SCHEDULE_EXACT_ALARM on Android 12+).
 * Returns true on web or pre-Android 12 (not applicable there).
 * On Android 12+, returns false until the user grants the permission via Settings.
 */
export async function checkExactAlarmPermission() {
    const plugin = await _getPlugin();
    if (!plugin) return true;
    try {
        const result = await plugin.checkExactNotificationSetting();
        return result.exact_alarm === 'granted';
    } catch (e) {
        return true; // older plugin version — assume OK
    }
}

/**
 * Open the Android "Alarms & Reminders" Settings page so the user can grant
 * SCHEDULE_EXACT_ALARM.  No-op on web or pre-Android 12.
 */
export async function requestExactAlarmSetting() {
    const plugin = await _getPlugin();
    if (!plugin) return;
    try {
        await plugin.changeExactNotificationSetting();
    } catch (e) {
        console.warn('[background-gong] changeExactNotificationSetting failed:', e);
    }
}

/**
 * Cancel all previously scheduled gong notifications.
 * Silently no-ops on web.
 */
export async function cancelBackgroundGongs() {
    const plugin = await _getPlugin();
    if (!plugin || _scheduledIds.length === 0) return;

    await plugin.cancel({ notifications: _scheduledIds.map(id => ({ id })) });
    _scheduledIds = [];
}
