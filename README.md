# Meditation Timer

A biofeedback meditation timer that tracks sessions, plays gong sounds, and — on Android with a Galaxy Watch — reads heart rate, HRV, SpO2, and respiration data from Health Connect to analyse your meditation depth after each session.

## Features

- **Distraction-free timer** with Start / Pause / Finish controls
- **Gong sounds** synthesized in real-time via the Web Audio API (no audio files to download):
  - 1 strike at 15 s — "settling-in" cue
  - N strikes every 15 minutes — N = number of 15-min intervals completed (1 at 15 m, 2 at 30 m, etc.)
- **Session history** grouped by date, with streak tracking and a 30-day bar chart
- **Bio-insight analysis** after every session:
  - Heart-rate settle time (how long until HR stabilised)
  - Respiration rate derived from heart-rate RSA oscillation (no chest strap needed)
  - Skin temperature friction periods (spikes indicating mental restlessness)
  - Torpor detection from SpO2 drops (brief drowsiness)
  - Overall session quality score: Deep / Restless / Somnolent
- **Chart.js time-series charts** in session detail: HR with settle-point annotation, HRV/Respiration dual-axis, Skin Temp with friction shading, SpO2 with torpor shading
- **Health Connect integration** (Android native): reads Galaxy Watch 7 biometrics automatically after each session — no manual export needed
- **PWA** — installable on any device, works fully offline via Service Worker
- **Dev panel** (localhost only): simulate bio sessions with mock profiles; seed and query Health Connect test data on the AVD

---

## Using the App (End User)

1. Tap **Start** to begin. The audio engine initialises in the background.
2. Tap **Pause** to temporarily stop the timer; tap **Start** again to resume.
3. Tap **Finish** to end the session — it is saved automatically.
   - On Android with Health Connect set up, the app queries your Galaxy Watch biometrics for the session window and displays bio charts in the session detail.
4. Tap a session in **History** to see full bio charts and insights.
5. Check the **Insights** tab for weekly stats, streak, 30-day session chart, and settle-time trend.

### Health Connect (Android)

The first time you finish a session on the Android app, a dialog asks you to allow Health Connect access. Tap **Allow**, then grant all requested permissions in the Health Connect screen that opens. If you tap **Skip**, you can re-enable later from the Health Connect system app.

Your Galaxy Watch syncs to Samsung Health, which writes data to Health Connect. The app reads from Health Connect — it never talks directly to the watch.

---

## Development Setup (first time only)

### 1. Install prerequisites

| Tool | How to install |
|------|---------------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) or `brew install node` |
| **Java 17** | `brew install openjdk@17` |
| **Android Studio** | [developer.android.com/studio](https://developer.android.com/studio) — install the Android SDK during setup |

After installing Java and Android Studio, add these lines to `~/.zshrc`:

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
```

Then reload your shell: `source ~/.zshrc`

### 2. Create the AVD

Open **Android Studio > Device Manager** and create a virtual device named exactly **`Meditation_Phone`** (Pixel 8 Pro, API 36 / Android 16 recommended). This name is hard-coded in `run.sh`.

### 3. Install npm dependencies

```bash
npm install
```

---

## Development Workflow

All dev tasks go through `run.sh`. It is idempotent — safe to re-run at any point.

```bash
./run.sh               # full flow: build → sync → install → launch (use after any code change)
./run.sh --skip-build  # re-install existing APK without rebuilding (quicker; only safe when native config unchanged)
./run.sh --stop        # shut down the emulator and web server
```

### What `run.sh` does step by step

| Step | Action | Skipped when |
|------|--------|-------------|
| 1 | Start `http-server` on `:8080` (serves `www/` locally) | Already running |
| 2 | Boot "Meditation_Phone" AVD | Already running |
| 3 | `npm run build` — Vite bundles `src/` → `www/` | `--skip-build` |
| 4 | `npx cap sync android` — copies `www/` into the Android project | `--skip-build` |
| 5 | `./gradlew assembleDebug --no-daemon` — compiles APK | `--skip-build` |
| 6 | Force-stop the running app on the AVD | — |
| 7 | `adb install` + clear app data + launch | — |

> **macOS Sequoia note:** `--no-daemon` is always passed to Gradle. This is required — the `com.apple.provenance` sandbox attribute on Sequoia prevents Gradle's forked daemon workers from writing build artifacts. It is the fix, not a workaround.

### Dev server (web only, no Android)

For rapid UI iteration without Gradle:

```bash
npm run dev     # Vite dev server on :5173 with hot-module reload
```

Open `http://localhost:5173`. The Dev Mode button appears automatically on localhost — tap it to simulate bio sessions with mock profiles.

---

## Project Structure

```
src/
  main.js                       # Entry: boot, storage factory, router init, dev panel
  style.css                     # All styles (single file)
  timer/
    timer.js                    # Timer state machine: startTimer / pauseTimer / finishTimer / gong rules
    gong.js                     # Gong synthesizer: additive sine waves + Web Audio API envelopes
  storage/
    storage-interface.js        # Abstract base — all methods return Promises
    local-storage-adapter.js    # Browser/PWA storage (localStorage key: meditation_sessions_v2)
    filesystem-adapter.js       # Android/iOS native storage (@capacitor/filesystem, Directory.Data)
    mock-adapter.js             # In-memory store with 5 seed sessions (used by tests)
    migration.js                # One-time v1→v2 schema migration
  bio/
    bio-math-engine.js          # Signal processing: RSA respiration, skin temp, torpor, classifySession
    mock-data.js                # Synthetic profiles: PROFILE_RESTLESS, PROFILE_DEEP, PROFILE_SOMNOLENT
    health-connect-service.js   # Android Health Connect: checkAvailability, requestPermissions, querySession, seedTestData
  ui/
    router.js                   # Hash-based routing: #timer #history #session/{id} #insights
    components/
      tab-bar.js                # Bottom nav (Timer / History / Insights)
      chart-panel.js            # Chart.js helpers: lineChartConfig, annotatedLineChartConfig, dualLineChartConfig
    views/
      timer-view.js             # Timer UI; attaches Health Connect telemetry on Finish
      session-view.js           # Session detail: bio insight card + 4 Chart.js panels
      dashboard-view.js         # History list grouped by date
      insights-view.js          # Weekly stats, streak, 30-day bar chart, settle-time trend
  utils/
    date-helpers.js             # formatDuration, formatTime, isSameDay, computeStreak, getLast30DaysData
    csv.js                      # parseCSV / toCSV helpers
public/
  service-worker.js             # Offline cache (CACHE_NAME: meditation-timer-v10)
  manifest.json                 # PWA manifest
www/                            # Vite build output — Capacitor webDir. Never edit directly.
android/                        # Capacitor Android wrapper project
  app/src/main/AndroidManifest.xml   # Health Connect permissions declared here
  variables.gradle              # SDK versions (compileSdk 36, minSdk 26, targetSdk 36)
```

---

## Testing

```bash
npm test
```

Runs 81 Vitest unit tests covering:
- Date helpers and CSV utilities
- Storage migration (v1 → v2)
- BioMathEngine: settle-time, RSA respiration, `extractRespirationFromHR`, skin temp friction, torpor detection, `classifySession`, `analyzeSession`

Tests run in a Node.js environment (no browser, no Android required).

---

## Bio Analysis — How It Works

After each session the app runs `analyzeSession(telemetry)` on the biometric time-series:

| Signal | Source (Android) | Source (web / fallback) |
|--------|-----------------|------------------------|
| Heart Rate | Health Connect — Galaxy Watch 7 | PROFILE_DEEP mock data |
| HRV (RMSSD) | Health Connect — Galaxy Watch 7 | Derived from mock HR |
| SpO2 | Health Connect — Galaxy Watch 7 | Mock |
| Respiration | Health Connect `respiratoryRate` field (preferred) → extracted from HRV oscillations → extracted from HR RSA oscillations | Extracted from mock HR |
| Skin Temp | Not available via current HC plugin | Mock |

**Settle time** — the first timestamp where the 2-min rolling HR average drops below the opening HR and stays there. Shown as a vertical line on the HR chart.

**Respiration from HR (RSA)** — heart rate rises on inhale and falls on exhale (respiratory sinus arrhythmia). The engine resamples HR to 4 Hz, applies a 0.05–0.4 Hz bandpass filter, and counts zero-crossings to find breath rate. Works at meditation breathing rates (3–8 br/min).

**Session quality** — classified as Deep, Restless, or Somnolent based on settle time, HR variability, respiration stability, and torpor flags.

---

## Health Connect — Developer Testing (AVD)

To test Health Connect on the Android emulator:

1. **Install Health Connect** on the AVD — download the Health Connect APK from the Google Play Store on the emulator, or sideload it.
2. Open the app on the AVD and tap the version number 5 times to open Dev Mode.
3. Tap **Seed HC Data (45 min)** — this writes 45 minutes of synthetic "Deep Absorption" biometric data into Health Connect (HR every 30 s, SpO2 + respiratory rate every 5 min), then reads it back and navigates to a session detail with real charts.

The seed data mirrors PROFILE_DEEP: HR declining from 75 → 58 bpm over the first 10 min with an RSA wave, SpO2 stable at 97–98%, respiratory rate 5–7 br/min.

---

## Versioning

When changing `src/` JS, CSS, or HTML, bump **two** things:

1. `APP_VERSION` in `src/main.js`
2. `CACHE_NAME` in `public/service-worker.js`

Vite handles JS/CSS cache-busting automatically via content hashes — no manual query-param bumping needed.

**Current:** `APP_VERSION = 'v7.0'`, `CACHE_NAME = 'meditation-timer-v10'`

---

## Browser Debug Tools

After clicking Start, open the browser console and use:

```javascript
meditationDebug.testGong()              // 1 gong strike
meditationDebug.testGong(3)             // 3 strikes
meditationDebug.setTime(10)             // jump to t=10 s
meditationDebug.setTime(895)            // jump to 14:55 (gong fires at 15:00)
meditationDebug.jumpToNextGong()        // auto-jump 5 s before the next gong
meditationDebug.simulateBioSession('deep')      // save a mock Deep session and navigate to it
meditationDebug.simulateBioSession('restless')  // profiles: 'restless' | 'deep' | 'somnolent'
meditationDebug.devPanel()              // open the Dev Mode panel programmatically
meditationDebug.storage                 // direct access to the storage adapter
```

---

## PWA Installation

### iOS (Safari)
1. Open the site in Safari.
2. Tap the Share button → **Add to Home Screen**.
3. Launch from the home screen for a full-screen experience.

### Android (Chrome)
1. Open the site in Chrome.
2. Tap the three-dot menu → **Add to Home Screen** (or accept the install banner).

### Desktop (Chrome / Edge)
1. Look for the install icon in the address bar (monitor with a down arrow).
2. Click to install as a standalone app.
