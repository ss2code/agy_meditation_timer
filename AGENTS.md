# AGENTS.md
**Doc Status:** Current Reference


This file provides guidance to Codex when working in this repository.

## Running the App

### Web dev
```bash
npm run dev
```
Vite dev server at `http://localhost:5173`.

### Production preview
```bash
npm run build
npm run preview
```
Builds `www/` and previews at `http://localhost:4173`.

### Tests
```bash
npm test
```
Current: **151 tests** (Vitest).

## Architecture

Vite PWA (ES modules) wrapped by Capacitor.

```
src/
  main.js                    ← boot, storage adapter selection, migration, router wiring, dev panel
  style.css
  timer/
    timer.js                 ← wall-clock elapsed time + visibility handling
    gong.js                  ← Web Audio gong synthesis
    background-gong.js       ← local-notification scheduling, channels, exact-alarm helpers, foreground service
  storage/
    storage-interface.js
    local-storage-adapter.js
    filesystem-adapter.js
    mock-adapter.js
    migration.js
  bio/
    bio-math-engine.js       ← settle time, respiration extraction, torpor, classification
    health-connect-service.js ← HC availability/permissions/query/seed
    mock-data.js
  ui/
    router.js
    session-language.js
    components/
      tab-bar.js
      chart-panel.js
    views/
      timer-view.js
      session-view.js
      dashboard-view.js
      insights-view.js
  utils/
    date-helpers.js
    csv.js
    escape-html.js
public/
  service-worker.js          ← offline cache (CACHE_NAME)
  manifest.json
www/                         ← Vite output (do not edit directly)
```

### Timer and gong flow

- Timer uses wall clock (`Date.now()`) to avoid drift under mobile background throttling.
- Gong rules:
  - `t = 15s` → 1 strike
  - `t % intervalSec === 0` → `t / intervalSec` strikes
- Default interval is 15 minutes (`900s`), runtime-toggleable to 5 minutes in dev diagnostics.
- Background gongs are scheduled at session start and rescheduled on `visibilitychange` resume.
- Foreground service is started/stopped with timer start/pause/finish for reliability.

### Session data (v2)

```js
{ id, startTimestamp, endTimestamp, duration,
  hasTelemetry, insights, type: 'meditation', schemaVersion: 2,
  telemetrySource: 'health_connect'|'mock', telemetryReason: string }
```

## Versioning Rule

When changing app runtime/UI files, bump both:

1. `APP_VERSION` in `src/main.js`
2. `CACHE_NAME` in `public/service-worker.js`

Current values:
- `APP_VERSION = 'v9.1'`
- `CACHE_NAME = 'meditation-timer-v46'`

If `CACHE_NAME` is not bumped, old cached `index.html` can mask updates on device.

## Android

### Emulator
```bash
./run.sh
./run.sh --skip-build
./run.sh --stop
```

### Physical phone
```bash
./deploy-phone.sh
./deploy-phone.sh --skip-build
```

Both scripts use persistent Gradle cache at `.gradle-home`. Do not switch to `/tmp` for Gradle home.

## Debug Tools

Available after clicking Start:

```javascript
meditationDebug.testGong()
meditationDebug.testGong(3)
meditationDebug.setTime(10)
meditationDebug.setTime(895)
meditationDebug.jumpToNextGong()
meditationDebug.simulateBioSession('deep')
meditationDebug.devPanel()
meditationDebug.storage
```
