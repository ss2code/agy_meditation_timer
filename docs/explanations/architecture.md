# Architecture Overview — Meditation Timer
**Doc Status:** Current Reference


## Overview

Meditation Timer is a Vite PWA packaged for Android/iOS with Capacitor. The app manages timed sessions, plays gong cues in foreground/background, stores sessions locally, and attaches post-session telemetry from Health Connect (or mock fallback).

## Runtime Layers

```
index.html shell
  -> src/main.js bootstraps app
    -> timer/      (timing + gong behavior)
    -> bio/        (telemetry analysis)
    -> storage/    (persistence adapters)
    -> ui/         (routing + views)
    -> utils/      (pure helpers)
```

## Boot Sequence (`src/main.js`)

1. Create storage adapter (`FilesystemAdapter` on native, `LocalStorageAdapter` on web)
2. Initialize storage and run migration
3. Initialize background-gong subsystem (`initBackgroundGongs`)
4. Mount views and tab bar
5. Initialize hash router callbacks
6. DEV-only: expose `window.meditationDebug` and long-press version footer for Dev panel

## Timer + Background Gong (`src/timer`)

- `timer.js`
  - Wall-clock elapsed calculation via `Date.now()`
  - `startTimer`, `pauseTimer`, `finishTimer`
  - `visibilitychange` handling for foreground/background transitions
- `gong.js`
  - Web Audio synthetic gong playback
- `background-gong.js`
  - Native local notification scheduling
  - Notification channel management
  - Exact alarm permission check/open-settings bridge
  - Foreground service start/stop wrappers
  - Runtime gong diagnostics log

### Gong rules

- `t = 15s` -> 1 strike
- `t % intervalSec === 0` -> `t / intervalSec` strikes
- Default interval is `900s` (15 min), configurable to `300s` (5 min) in dev diagnostics

## Bio Analysis (`src/bio`)

- `health-connect-service.js`: availability, permissions, query, and dev seed helpers
- `bio-math-engine.js`:
  - settle-time detection from HR
  - respiration source priority:
    1. direct HC respiration
    2. RSA from HRV
    3. RSA from HR
  - torpor detection from low respiration + SpO2 drop
  - session classification (`somnolent`, `deep_absorption`, `absorbed`, `settling`, `restless`)

On native session finish, timer view polls Health Connect (8 attempts, 15s interval). If no HR data arrives, mock telemetry is attached to keep session UX complete.

## UI (`src/ui`)

- `router.js`: hash routing (`#timer`, `#history`, `#session/{id}`, `#insights`)
- `views/timer-view.js`: controls, quick stats, telemetry attach flow
- `views/dashboard-view.js`: grouped history list
- `views/session-view.js`:
  - Session Note summary
  - Evidence panel + diagnostics
  - watch-evidence charts for HC sessions with HR samples (HR + SpO2)
- `views/insights-view.js`: weekly rollup, streak, 30-day chart, settle trend

## Persistence (`src/storage`)

Storage adapter abstraction with Promise-based interface:

- `LocalStorageAdapter` (browser)
- `FilesystemAdapter` (native)
- shared schema migration via `migration.js`

Session metadata and raw telemetry are stored separately.

## Caching + Versioning

`public/service-worker.js` uses cache-first for same-origin resources.

When changing runtime/UI code, bump both:
- `APP_VERSION` in `src/main.js`
- `CACHE_NAME` in `public/service-worker.js`

Current values:
- `APP_VERSION = 'v9.1'`
- `CACHE_NAME = 'meditation-timer-v46'`
