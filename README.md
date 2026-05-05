# Meditation Timer
**Doc Status:** Current Reference


Meditation Timer is a Vite-based PWA wrapped with Capacitor for Android/iOS. It provides a distraction-free timer, gong cues, local session history, and post-session bio insights from Health Connect (with mock fallback when watch data is unavailable).

## Features

- Wall-clock meditation timer (`Date.now()`-based) resilient to background throttling
- Gong engine via Web Audio (`src/timer/gong.js`)
- Background gong scheduling on Android via local notifications (`src/timer/background-gong.js`)
- Foreground service while timer runs to improve long-session reliability on aggressive OEM battery managers
- Session history + weekly/monthly insights
- Session Note summary with supporting watch evidence charts
- Health Connect integration (HR required; HRV/SpO2/respiratory data optional)
- Dev-only panel for bio simulation, gong diagnostics, and Health Connect seed/query testing

## Running the App

```bash
npm run dev
```

Opens Vite dev server at `http://localhost:5173`.

### Production Preview

```bash
npm run build
npm run preview
```

Builds `www/` and serves preview at `http://localhost:4173`.

## Testing

```bash
npm test
```

Current suite: **151 tests** (Vitest).

## Android Workflows

### Emulator

```bash
./run.sh
./run.sh --skip-build
./run.sh --stop
```

`run.sh` handles web build, Capacitor sync, Gradle debug build, install, and launch. It targets a running emulator serial explicitly to avoid multi-device `adb` conflicts.

### Physical Device

```bash
./deploy-phone.sh
./deploy-phone.sh --skip-build
```

Builds/deploys to a connected physical device and prompts for device selection if needed.

## Health Connect Behavior

- On session finish (native), the app checks HC availability and permission.
- If permission is granted, it polls up to 8 attempts every 15s for watch sync.
- If HR arrives, telemetry is saved with source `health_connect` and insights are computed.
- If not, mock telemetry is attached so every session still has readable insights.
- In session view, **Update Health Connect** can re-query the original session window.

## Session View

- Session Note card: settle time + HR change narrative (`src/ui/session-language.js`)
- Evidence panel with summary stats
- Watch-evidence charts render only for Health Connect sessions with HR samples:
  - Heart Rate (with settle-time annotation)
  - SpO2 (with torpor period shading)
- Raw Data diagnostics panel includes sample counts, min/max/mean, and respiration source/confidence

## Debug Tools (Browser Console)

Available after pressing Start:

```javascript
meditationDebug.testGong()                  // Play one gong immediately
meditationDebug.testGong(3)                 // Play three strikes
meditationDebug.setTime(895)                // Jump timer to 14:55
meditationDebug.jumpToNextGong()            // Jump to 5s before next gong
meditationDebug.simulateBioSession('deep')  // Save simulated session and open it
meditationDebug.devPanel()                  // Toggle Dev panel
meditationDebug.storage                     // Active storage adapter
```

## Architecture Snapshot

```
src/
  main.js                       # Boot, storage adapter selection, migration, router wiring, dev panel
  style.css
  timer/
    timer.js                    # Wall-clock timer logic + visibility handling
    gong.js                     # Web Audio gong synthesizer
    background-gong.js          # Android notification scheduling + channels + exact alarm helpers + foreground service
  storage/
    storage-interface.js
    local-storage-adapter.js
    filesystem-adapter.js
    mock-adapter.js
    migration.js
  bio/
    bio-math-engine.js          # settle time, respiration extraction, torpor, classification
    health-connect-service.js   # HC availability/permissions/query/seed
    mock-data.js
  ui/
    router.js
    session-language.js
    components/
      tab-bar.js
      chart-panel.js
    views/
      timer-view.js
      dashboard-view.js
      session-view.js
      insights-view.js
  utils/
    date-helpers.js
    csv.js
    escape-html.js
public/
  service-worker.js
  manifest.json
www/                            # Build output (do not edit)
```

## Versioning Rule (Important)

When changing app UI/runtime files (`src/`, `index.html`, service worker behavior), bump:

1. `APP_VERSION` in `src/main.js`
2. `CACHE_NAME` in `public/service-worker.js`

Current values:
- `APP_VERSION = 'v9.1'`
- `CACHE_NAME = 'meditation-timer-v46'`

This prevents stale cached `index.html` from masking UI updates on-device.
