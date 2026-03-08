# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

**Dev server (preferred for web development):**
```bash
npm run dev
```
Opens at `http://localhost:5173` with Vite HMR.

**Production preview (what the Android APK runs):**
```bash
npm run build    # Vite → www/
npm run preview  # serves www/ at :4173
```

**Tests:**
```bash
npm test         # Vitest (112 tests)
```

## Architecture

Vite-bundled PWA (ES modules), Capacitor-wrapped for Android/iOS.

```
src/
  main.js                    ← entry point: boot, storage factory, router init
  style.css                  ← all styles
  timer/
    timer.js                 ← wall-clock elapsed time (Date.now()), startTimer/pauseTimer/finishTimer, gong rules, visibilitychange sync
    gong.js                  ← Gong class: additive synthesis, Web Audio API
  storage/
    storage-interface.js     ← abstract base (all methods return Promises)
    local-storage-adapter.js ← PWA fallback (localStorage, key: meditation_sessions_v2)
    filesystem-adapter.js    ← native Android/iOS (@capacitor/filesystem, Documents/MeditationApp/)
    mock-adapter.js          ← in-memory with 5 seed sessions (dev/testing)
    migration.js             ← one-time v1→v2 migration (flag: meditation_migration_v6_complete)
  bio/
    bio-math-engine.js       ← pure signal processing: settleTime, RSA respiration, skin temp, torpor
    mock-data.js             ← synthetic profiles: PROFILE_RESTLESS, PROFILE_DEEP, PROFILE_SOMNOLENT
    health-connect-service.js ← Android Health Connect: checkAvailability, requestPermissions, querySession
  ui/
    router.js                ← hash-based routing (#timer #history #session/{id} #insights)
    components/
      tab-bar.js             ← bottom nav (Timer / History / Insights)
      chart-panel.js         ← createChart(), barChartConfig(), lineChartConfig()
    views/
      timer-view.js          ← timer UI; attaches Health Connect or mock telemetry on Finish
      session-view.js        ← session detail: bio insights card + 4 Chart.js panels
      dashboard-view.js      ← history grouped by date
      insights-view.js       ← weekly stats, streak, 30-day bar chart, settle-time trend
  utils/
    date-helpers.js          ← formatDuration, formatTime, isSameDay, computeStreak, getLast30DaysData
    csv.js                   ← parseCSV, toCSV
public/
  service-worker.js          ← offline cache (CACHE_NAME: meditation-timer-v21)
  manifest.json
www/                         ← Vite build output (Capacitor webDir — do not edit directly)
```

**Storage factory** (`main.js`): `createStorageAdapter()` returns `FilesystemAdapter` on native
Capacitor, `LocalStorageAdapter` in browser.

**Timer flow:** `startTimer()` → records `Date.now()` as wall-clock start → `setInterval` fires
UI ticks → elapsed computed as `floor((Date.now() - startWall) / 1000)` → gong rules →
`finishTimer()` → `onSessionSave` callback → `saveSession()` immediately.

Wall-clock design is intentional: Android throttles/freezes `setInterval` when screen turns off.
A tick counter would drift; `Date.now()` is always accurate. `visibilitychange` forces immediate
resync when screen unlocks.

**Gong rules:**
- `t=15s`: 1 strike (settling-in)
- `t % 900 === 0`: N strikes (N = 15-min intervals completed)

**Session schema v2** (key fields):
```js
{ id, startTimestamp, endTimestamp, duration,
  hasTelemetry, insights, type: 'meditation', schemaVersion: 2,
  telemetrySource: 'health_connect'|'mock', telemetryReason: string }
```

**RSA Respiration algorithm** (`bio-math-engine.js`):
Heart rate oscillates with breathing (Respiratory Sinus Arrhythmia). The engine extracts
breathing rate by: (1) resampling to uniform 4 Hz, (2) detrending with 25 s moving average,
(3) finding the dominant frequency via DFT with Hanning window in each 60 s sliding window
(step 30 s). Uses parabolic interpolation for sub-bin accuracy. Band: 0.05–0.6 Hz (3–36 bpm).
Previous zero-crossing approach undercounted with low-amplitude RSA from sparse Health Connect data.

**Health Connect permissions**: Only `heartRate` is required for `granted = true`. Other types
(`heartRateVariability`, `oxygenSaturation`, `respiratoryRate`) are requested but treated as
optional — Samsung watches may not support all HC data types. The "Update Health Connect"
button in session-view always checks/requests permissions before querying.

## Versioning

When changing `src/` JS, CSS, or HTML, bump **two** things:

1. `APP_VERSION` in `src/main.js`
2. `CACHE_NAME` in `public/service-worker.js`

Vite handles JS/CSS cache-busting automatically via content hashes.

**Current:** `APP_VERSION='v7.11'`, `CACHE_NAME='meditation-timer-v21'`

**Why CACHE_NAME matters on device:** The service worker caches `index.html` with a
cache-first strategy and stays alive across APK reinstalls. If CACHE_NAME is not bumped,
the SW serves the old cached `index.html` — so UI changes appear to have no effect on
device even though `npm run dev` shows them correctly. Bumping CACHE_NAME forces the SW
to delete the old cache on next activate.

## Mobile / Android

**Build and deploy to AVD:**
```bash
./run.sh                # full flow: build → cap sync → gradle → install → launch
./run.sh --skip-build   # re-install existing APK without rebuilding
./run.sh --stop         # shut down emulator + web server
```

`run.sh` detects the emulator serial via `adb devices | grep "^emulator"` and passes
`-s $EMULATOR_SERIAL` to all adb commands. This is required — if a physical phone is also
connected, plain `adb` fails with "more than one device/emulator".

**Build and deploy to physical phone:**
```bash
./deploy-phone.sh               # build + deploy to physical device
./deploy-phone.sh --skip-build  # re-deploy existing APK
```

`deploy-phone.sh` scans connected devices and prompts for selection when multiple are found.

**Gradle cache:** Both scripts use `GRADLE_USER_HOME="$PROJECT_ROOT/.gradle-home"` (gitignored,
persistent). Do not change this to `/tmp/` — it gets wiped and causes a full Gradle distribution
re-download (~200 MB) on every run.

See `android/CLAUDE.md` for Capacitor sync details, CLI build flags, and AVD setup.

## Debug Tools (Browser Console)

Available after clicking Start:

```javascript
meditationDebug.testGong()           // 1 gong strike
meditationDebug.testGong(3)          // 3 strikes
meditationDebug.setTime(10)          // jump to t=10s
meditationDebug.setTime(895)         // jump to 14:55 (gong at 15:00)
meditationDebug.jumpToNextGong()     // auto-jump 5s before next gong
meditationDebug.storage              // storage adapter instance
```
