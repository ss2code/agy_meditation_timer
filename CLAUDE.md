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
npm test         # Vitest (73 tests)
```

## Architecture

Vite-bundled PWA (ES modules), Capacitor-wrapped for Android/iOS.

```
src/
  main.js                    ← entry point: boot, storage factory, router init
  style.css                  ← all styles
  timer/
    timer.js                 ← timer state, startTimer/pauseTimer/finishTimer, gong rules
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
  ui/
    router.js                ← hash-based routing (#timer #history #session/{id} #insights)
    components/
      tab-bar.js             ← bottom nav (Timer / History / Insights)
      chart-panel.js         ← createChart(), barChartConfig(), lineChartConfig()
    views/
      timer-view.js          ← timer; saves session automatically on Finish
      session-view.js        ← session detail: bio insights card
      dashboard-view.js      ← history grouped by date
      insights-view.js       ← weekly stats, streak, 30-day bar chart
  utils/
    date-helpers.js          ← formatDuration, formatTime, isSameDay, computeStreak, getLast30DaysData
    csv.js                   ← parseCSV, toCSV
public/
  service-worker.js          ← offline cache (CACHE_NAME: meditation-timer-v9)
  manifest.json
www/                         ← Vite build output (Capacitor webDir — do not edit directly)
```

**Storage factory** (`main.js`): `createStorageAdapter()` returns `FilesystemAdapter` on native
Capacitor, `LocalStorageAdapter` in browser.

**Timer flow:** `startTimer()` → `setInterval` → gong rules → `finishTimer()` → `onSessionSave`
callback → `saveSession()` immediately.

**Gong rules:**
- `t=15s`: 1 strike (settling-in)
- `t % 900 === 0`: N strikes (N = 15-min intervals completed)

**Session schema v2** (key fields):
```js
{ id, startTimestamp, endTimestamp, duration,
  hasTelemetry, insights, type: 'meditation', schemaVersion: 2 }
```

## Versioning

When changing `src/` JS, CSS, or HTML, bump **two** things:

1. `APP_VERSION` in `src/main.js`
2. `CACHE_NAME` in `public/service-worker.js`

Vite handles JS/CSS cache-busting automatically via content hashes.

**Current:** `APP_VERSION='v6.0'`, `CACHE_NAME='meditation-timer-v9'`

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

## Mobile / Android

**Build and deploy to AVD:**
```bash
./run.sh                # full flow: build → cap sync → gradle → install → launch
./run.sh --skip-build   # re-install existing APK without rebuilding
./run.sh --stop         # shut down emulator + web server
```

`run.sh` runs `npm run build` (Vite → `www/`), then `cap sync android`, then Gradle.
The http-server it starts serves `www/` at `:8080` (the built app, same as the APK).

See `android/CLAUDE.md` for Capacitor sync details, CLI build flags, and AVD setup.
