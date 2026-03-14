# Architecture Overview — Meditation Timer

## Overview

Meditation Timer is a Vite-bundled PWA that runs as a standalone web app and is also packaged as an Android APK via Capacitor. It lets users run timed meditation sessions with gong sounds, records biometric telemetry (heart rate, HRV, SpO2 via Android Health Connect), and displays post-session analysis.

---

## Module Layers

```
┌─────────────────────────────────────────────────────────┐
│  index.html  (static shell, 4 view divs)                │
│  src/main.js (boot, wires all layers together)          │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────────┐  ┌──────────────┐
  │  timer/  │  │     bio/     │  │   storage/   │
  │ (state)  │  │ (analytics)  │  │ (persistence)│
  └──────────┘  └──────────────┘  └──────────────┘
        │              │                  │
        └──────────────┴──────────────────┘
                       │
              ┌────────▼────────┐
              │      ui/        │
              │ (views, router) │
              └─────────────────┘
                       │
              ┌────────▼────────┐
              │    utils/       │
              │ (pure helpers)  │
              └─────────────────┘
```

---

## Layers & Responsibilities

### `main.js` — Boot & Wiring
The single entry point. `boot()` runs once:
1. Creates the storage adapter (Filesystem on native, LocalStorage on web)
2. Runs v1→v2 migration
3. Initializes background gong notification channels via `initBackgroundGongs()` (native only, fire-and-forget)
4. Mounts all views and the tab bar
5. Initializes the hash-based router with view-render callbacks
6. Registers the service worker
7. Exposes `window.meditationDebug` for console tooling and mounts a hidden Dev Panel toggle

**Key design**: `main.js` is the only place that constructs the `storage` instance, which is then passed down to all views. This is manual dependency injection — no framework. `main.js` also scaffolds dev-mode tools like `simulateBioSession` and the visual Dev Panel.

---

### `timer/` — Timer State Machine

| File | Responsibility |
|------|----------------|
| `timer.js` | Wall-clock elapsed time, start/pause/finish, gong scheduling |
| `gong.js` | `Gong` class: Web Audio API additive synthesis, 15s resonant sound |
| `background-gong.js` | Schedules `@capacitor/local-notifications` when screen locks; manages notification channels, custom sounds, intervals, and diagnostic logging; cancels on resume |

**Wall-clock design** (`timer.js`): Uses `Date.now()` not a tick counter. Android throttles `setInterval` when screen is off — a counter would drift. Elapsed = `floor((Date.now() - resumeWallTime) / 1000) + accumulatedBeforePause`.

**Gong rules**: `t=15s` → 1 strike (settle-in). `t % 900 === 0` → N strikes (N = completed 15-min intervals). The interval handler replays all skipped seconds (`_checkGongs(prevTime, currTime)`) to handle throttled intervals catching up.

**Visibility handling**: `visibilitychange` is wired at module load. `hidden` → schedule background notifications. `visible` → cancel notifications, re-sync wall clock, replay any missed gongs.

---

### `bio/` — Biometric Analysis

| File | Responsibility |
|------|----------------|
| `bio-math-engine.js` | Pure signal processing: settleTime, RSA respiration, HRV, torpor detection |
| `health-connect-service.js` | Android Health Connect bridge: availability check, permissions, query, seed |
| `mock-data.js` | Synthetic profiles: RESTLESS, DEEP, SOMNOLENT (for dev/testing) |

**`analyzeSession(telemetry)`** is the main entry point in `bio-math-engine.js`. Returns an `insights` object: `{ sessionQuality, avgHR, respirationRate, skinTemp, settleTime, torpor, ... }`.

**RSA respiration pipeline**: HR series → resample to 4 Hz → detrend (25s moving avg) → DFT with Hanning window per 60s sliding window (step 30s) → peak frequency in 0.05–0.6 Hz band → parabolic interpolation → bpm.

**Health Connect**: Only `heartRate` is required for `granted = true`. HRV, SpO2, respRate are optional (Samsung watches may not support them). On session finish, `timer-view.js` polls HC 8 × 15s with a sync overlay. A manual "Update Health Connect" button in session-view allows retry.

---

### `storage/` — Persistence Layer

```
DataStorageInterface (abstract)
    ├── LocalStorageAdapter   (browser, key: meditation_sessions_v2)
    ├── FilesystemAdapter     (native, @capacitor/filesystem, Documents/MeditationApp/)
    └── MockAdapter           (in-memory, 5 seed sessions, for tests)
```

All methods return Promises. Contract: `initialize`, `saveSession`, `getSession`, `getAllSessions`, `saveTelemetry`, `getTelemetry`, `deleteSession`.

**Storage factory** in `main.js`: `Capacitor.isNativePlatform()` → `FilesystemAdapter`, else → `LocalStorageAdapter`.

**Session schema v2**: `{ id, startTimestamp, endTimestamp, duration, hasTelemetry, insights, type, schemaVersion: 2, telemetrySource, telemetryReason }`. Telemetry stored separately from session metadata.

**Migration** (`migration.js`): One-time v1→v2 migration behind flag `meditation_migration_v6_complete`.

---

### `ui/` — Views & Routing

| File | Responsibility |
|------|----------------|
| `router.js` | Hash-based SPA routing (`#timer`, `#history`, `#session/{id}`, `#insights`) |
| `components/tab-bar.js` | Bottom nav, drives hash changes |
| `components/chart-panel.js` | Chart.js wrappers: bar + line configs |
| `views/timer-view.js` | Main screen: timer controls, recent sessions, stats; attaches HC or mock telemetry after Finish |
| `views/session-view.js` | Session detail: bio insights card + 4 Chart.js panels |
| `views/dashboard-view.js` | History grouped by date |
| `views/insights-view.js` | Weekly stats, streak, 30-day bar chart, settle-time trend |

**Router**: DOM-level. `hashchange` → show/hide `.view` divs via `view--active` CSS class. Calls the matching `viewHandler(params)` registered by `main.js`. `navigateTo(view, params)` sets `window.location.hash`.

**Mount vs render split**: Each view has a `mountXxxView(storage)` called once at boot (creates DOM skeleton), and a `renderXxxView(params)` called on every navigation (fills in data).

---

### `utils/` — Pure Helpers

| File | Contents |
|------|----------|
| `date-helpers.js` | `formatDuration`, `formatTime`, `isSameDay`, `computeStreak`, `getLast30DaysData` |
| `csv.js` | `parseCSV`, `toCSV` (for export/import) |

No DOM, no storage deps.

---

## Data Flow: Session Lifecycle

```
[User taps Start]
    → startTimer() — records wall-clock start, opens Web Audio
    → setInterval ticks → onTickCallback → timer-view updates display
    → gong.play() at t=15s, t=900s, ...
    → [screen lock] → scheduleBackgroundGongs(elapsedTime)
    → [screen unlock] → cancelBackgroundGongs(), handleVisibilityResume()

[User taps Finish]
    → finishTimer() → onSessionSaveCallback({ duration, startTimestamp, endTimestamp })
    → timer-view: creates session skeleton, calls storage.saveSession()
    → polls Health Connect (8 × 15s) OR uses mock telemetry
    → analyzeSession(telemetry) → insights object
    → storage.saveTelemetry(sessionId, telemetry)
    → storage.saveSession(session with insights)
    → navigateTo('session', [sessionId])

[Session view renders]
    → storage.getSession(id) + storage.getTelemetry(id)
    → bio insights card: quality tag, HR, respiration, settle time
    → 4 Chart.js panels: HR, HRV, SpO2, respiration
```

---

## Key Architectural Decisions

- **No framework**: Vanilla ES modules + direct DOM manipulation. Fast load, minimal deps, works offline.
- **Wall-clock timer**: Resilient to Android `setInterval` throttling. The only safe approach for a background-capable mobile timer.
- **Storage abstraction**: Adapter pattern allows the same app logic to run on web (localStorage) and native (filesystem) without if-branches in business logic.
- **Pure bio engine**: `bio-math-engine.js` has zero side effects — easy to unit test and swap implementations.
- **Capacitor bridge**: The web app is the source of truth; Capacitor is a thin shell. Native features (HC, notifications, filesystem) are accessed via Capacitor plugins.
- **Service worker + CACHE_NAME versioning**: Cache-first strategy means UI changes require bumping `CACHE_NAME` or the old `index.html` is served forever on device.
