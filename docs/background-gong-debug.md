# Background Gong Bug — Debug Session Notes

## The Bug (original)

Gong fires at 15s (screen on, Web Audio). Does NOT fire at 15-min / 30-min marks while
phone is sleeping. After unlocking the phone, one catch-up gong plays via Web Audio.

---

## Root Causes Found and Fixed (in discovery order)

### Root Cause 1 — SCHEDULE_EXACT_ALARM missing from manifest (v7.16)
Without this permission, `canScheduleExactAlarms()` returns false on Android 12+.
**Status: Fixed** — added to AndroidManifest.xml.

### Root Cause 2 — POST_NOTIFICATIONS was blocked (user fixed in Settings)
**Status: Fixed** — user enabled notifications in Settings.

### Root Cause 3 — Race condition: async scheduling vs WebView suspension (v7.17)
Scheduling on `visibilitychange → hidden` gave too little time before Android suspended
the WebView. Fixed by scheduling proactively at session start.
**Status: Fixed** — session-start scheduling confirmed working.

### Root Cause 4 — `checkExactNotificationSetting()` hangs on this device (v7.20)
`_checkExactAlarmOnce()` was called before `initBackgroundGongs()` in `_onStart()`.
The bridge call hung forever, blocking all subsequent scheduling.
**Status: Fixed** — `_checkExactAlarmOnce` moved to fire-and-forget after init.

### Root Cause 5 — `_permissionGranted` gate permanently blocks scheduling (v7.22)
`initBackgroundGongs()` checked `checkPermissions()` before setting `_permissionGranted = true`.
The user locked the screen while this async call was pending. Android freezes ALL JavaScript
(including the 2-second `setTimeout` fallback from v7.21). `_permissionGranted` stayed
`false` forever. Every subsequent `scheduleBackgroundGongs()` call was skipped.
**Status: Fixed** — removed `_permissionGranted` gate entirely.

### Root Cause 6 — Diagnostic mode doubled gong sounds (v7.23)
With notifications confirmed working, both mechanisms fired independently:
- Android notification played the gong while the screen was locked
- Web Audio catch-up replayed the same gong when the user opened the phone
**Status: Fixed** — `handleVisibilityResume()` now cancels pending notifications and skips catch-up.

### Root Cause 7 — `initBackgroundGongs()` hangs, blocking sessionStart schedule (v7.24)
`_onStart()` did `await scheduleBackgroundGongs(0, 'sessionStart')` but this called
`await _getPlugin()` which hung (the `await import(...)` or `await createChannel(...)` never
completed). No notifications were ever scheduled at session start.
**Status: Fixed in v7.24** — `scheduleBackgroundGongs()` loads the plugin itself. But the
underlying hang persisted (see Root Cause 8).

### Root Cause 8 — Dynamic `import()` hangs on this device (v8.0) — THE REAL ROOT CAUSE

All previous fixes were working around the same fundamental problem: **the dynamic
`await import('@capacitor/local-notifications')` call inside `_getPlugin()` hung on this
Android device/WebView.** The `await` continuation never fired, blocking every function
that depended on it.

Evidence from v7.24 logs:
- `initBackgroundGongs() called` at 12:15:27 (session start)
- **NO `schedule(0s) by:sessionStart` log entry** — the `await _getPlugin()` inside
  `scheduleBackgroundGongs()` hung before reaching the log line
- `schedule(1120s) by:visibilityResume` at 12:34:08 (user unlocked 19 min later)
  — plugin was eventually loaded, but the original `await` continuation was lost

The 5-min test "worked" because the user checked the phone at ~4s, triggering
`visibilityResume` which loaded the plugin fresh. The 15-min test failed because
the user didn't check until 19 min — by then all gong times had passed with zero
notifications scheduled.

**Status: Fixed in v8.0** — Complete rewrite of `background-gong.js`:
1. **Static import** — `import { LocalNotifications } from '@capacitor/local-notifications'`
   resolved at bundle time by Vite, no dynamic `import()` that can hang
2. **Channel creation at boot** — `initBackgroundGongs()` called from `main.js boot()`,
   not from session start. Channels persist across app restarts (localStorage flag).
3. **Zero async dependencies in schedule path** — `scheduleBackgroundGongs()` calls
   `LocalNotifications.schedule()` directly, no `_getPlugin()`, no gates.
4. **Notification listener at module load** — registered synchronously when the module
   is first parsed, not during an async init chain.

### Root Cause 9 — OEM Battery Managers wipe AlarmManager exact alarms (v8.1) — FINAL ACTUAL ROOT CAUSE

Even after getting static imports working in v8.0, 15-minute intervals continued to fail because Android devices with aggressive OEM battery managers (e.g. Samsung, Xiaomi) silently Force Stop the application after ~10 minutes of background inactivity. This Force Stop entirely bypasses standard Android Doze optimizations and wipes all scheduled alarms from the `AlarmManager`.

The 5-minute intervals succeeded purely by accident: firing an alarm every 5 minutes woke the app up just often enough to reset the battery manager's 10-minute idle countdown, preventing the Force Stop entirely.

**Status: Fixed in v8.1** — Implemented `@capawesome-team/capacitor-android-foreground-service`. By starting a Foreground Service when the timer begins, the app's priority is elevated to be equivalent to the foreground. The OEM battery killers will not suspend or Force Stop an app with an active Foreground Service, meaning the app stays alive and intact for the entire session.

---

## Current State (v8.1)

### Architecture: Scheduling Flow

```
boot() in main.js
  └── initBackgroundGongs()              ← fire-and-forget: creates channels (once ever), requests permissions
                                            channels persist in Android across restarts (localStorage flag)

_onStart() in timer-view.js
  └── scheduleBackgroundGongs(0)         ← DIRECT CALL to LocalNotifications.schedule()
  └── _checkExactAlarmOnce()             ← fire-and-forget, UI banner only

visibilitychange → hidden
  └── handleVisibilityHidden()           ← sync elapsed only (no scheduling)

visibilitychange → visible
  └── handleVisibilityResume()
        └── cancelBackgroundGongs()       ← notifications done, Web Audio takes over
        └── _lastGongCheckTime = elapsed  ← skip catch-up (notifications handled those)
        └── scheduleBackgroundGongs()     ← reschedule for next background period

pause / finish
  └── cancelBackgroundGongs()
```

### What Changed in v8.0
- **Static import** of `@capacitor/local-notifications` (was `await import(...)`)
- **Static import** of `@capacitor/core` for `Capacitor.isNativePlatform()`
- Removed `_getPlugin()` function entirely — no lazy async plugin loading
- Removed `_initComplete` flag — not needed when there's nothing async to track
- Removed preflight notifications — simplified back to core gong scheduling
- `initBackgroundGongs()` moved from `_onStart()` to `boot()` in main.js
- `_onStart()` awaits `scheduleBackgroundGongs()` (safe — user is in foreground)
- `_ensureChannels()` called at boot AND before each schedule (channels required for display)
- Channel creation has 5s timeout and localStorage persistence
- Permission check has 3s timeout
- Exact alarm check has 3s timeout
- Notification delivery listener registered at module load time

---

## Known Limitations (Android OS level)

### Multi-strike throttle
The Capacitor plugin uses `AlarmManager.setExactAndAllowWhileIdle()`, which has a
**9-minute per-app throttle** in Doze mode. Multi-strike gongs (e.g., 2 strikes at
t=30m, 7s apart) will only play the FIRST strike while backgrounded. The second alarm
is within the 9-minute window and may be delayed/batched. User still hears one gong
per interval. To fix: pre-render multi-strike WAV files (one file per strike count).

### OEM battery killers
Samsung, Xiaomi, Huawei, OnePlus have aggressive battery managers that can suppress
even exact alarms. No programmatic fix — users may need to disable battery optimization
for the app. See [dontkillmyapp.com](https://dontkillmyapp.com/).

### Android 14+ exact alarm permission
`SCHEDULE_EXACT_ALARM` is DENIED by default for new installs on API 34+. Without it,
the plugin falls back to `setAndAllowWhileIdle()` (non-exact, even less reliable).
The app shows an "Alarms & Reminders" permission banner. If user denies, gong timing
may be imprecise but should still fire.

### Foreground Service capability (v8.1+ Solution)
As of v8.1, the application uses `@capawesome-team/capacitor-android-foreground-service` to show a persistent "Meditation in progress" notification while the timer is running. This elevated priority effectively bypasses OEM battery killers and keeps the app process alive continuously, serving as the ultimate fix for precise gong timing on modern aggressive Android devices.

---

## Notification Channels

| Channel ID | Name | Sound | Importance | Purpose |
|---|---|---|---|---|
| `gong` | Meditation Gong | gong.wav | 5 (URGENT) | Custom gong sound |
| `gong_diag` | Meditation Gong (Chime) | system default | 5 (URGENT) | Android system chime |

---

## Diagnostic Log Interpretation

| Log pattern | Meaning |
|---|---|
| `schedule SUCCESS` + `VERIFY: N > 0` | Notifications scheduled and accepted by Android |
| `NOTIF DELIVERED` appears | Gong notification fired by Android |
| `VERIFY: 0 pending` | Android rejected the schedule — check exact alarm permission |
| `schedule FAILED` | Plugin call threw — check error message |
| `Channel creation failed` | Channels not created — notifications will be SILENTLY DROPPED when they fire |
| `Channels already created (persisted)` | Normal — channels only need to be created once |

---

## Key Files

| File | Relevance |
|------|-----------|
| `src/timer/background-gong.js` | All scheduling logic, runtime config, logging |
| `src/timer/timer.js` | `handleVisibilityHidden/Resume`, `_checkGongs` |
| `src/ui/views/timer-view.js` | `_onStart` — schedules gongs |
| `src/main.js` | `boot()` — calls `initBackgroundGongs()` at startup |
| `android/app/src/main/AndroidManifest.xml` | `SCHEDULE_EXACT_ALARM` permission |

---

## Test Procedure

**DO NOT use USB** — USB prevents Doze and gives false positives. Even after disconnecting
USB, wait 2+ minutes before testing (Doze residual).

### 5-min test (quick validation):
1. Build + deploy → disconnect USB → wait 2 min
2. Open app → History tab → Dev Debug → Clear Log
3. Ensure interval shows "5 min" and Sound shows "Sound: Gong"
4. Close panel → tap Start → stay on timer screen for 5-10 seconds
5. Go to History tab → Dev Debug → confirm `schedule SUCCESS` and `VERIFY: N > 0`
6. Lock phone → wait 6 min → should hear ONE gong sound (not two!)
7. Unlock → Dev Debug → View Gong Log → check for:
   - `NOTIF DELIVERED` (confirms notification, not Web Audio)
   - Only ONE gong sound per interval (no doubling)

### 15-min production test:
1. In Dev Debug: tap "5 min" to toggle to "15 min"
2. Start fresh session → lock phone → wait 16 min
3. Should hear ONE gong at ~15:00
4. Unlock → check log for `NOTIF DELIVERED`
