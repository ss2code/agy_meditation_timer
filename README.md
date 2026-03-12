# Meditation Timer

A biofeedback meditation timer that tracks sessions, plays gong sounds, and — on Android with a Galaxy Watch — reads heart rate, HRV, SpO2, and respiration data from Health Connect to analyse your meditation depth after each session.

## Features

- **Distraction-free timer** with Start / Pause / Finish controls
- **Gong sounds** synthesized in real-time via the Web Audio API (no audio files to download):
  - 1 strike at 15 s — "settling-in" cue
  - N strikes every 15 minutes — N = number of 15-min intervals completed (1 at 15 m, 2 at 30 m, etc.)
  - **Works while the phone sleeps** — when the screen turns off, gongs are pre-scheduled as Android system notifications so they fire even in Doze mode (requires granting Alarms & Reminders permission on Android 13+; see below)
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

### Background gongs — Alarms & Reminders permission (Android 13+)

Gongs fire at exact times even while the screen is off, using the Android alarm system. On **Android 13 and later**, the OS requires apps to be explicitly granted the *Alarms & Reminders* special permission — it is not granted automatically.

When you tap **Start** for the first time, an orange banner appears at the top of the screen if this permission is missing:

> *"Gongs need Alarms & Reminders permission to fire while screen is off."*

Tap **Fix** and the Android settings page opens. Toggle **Meditation Timer** on, then return to the app. The banner will not reappear.

On **Android 12** the permission is granted automatically on install — no action needed.

If you skip the banner, gongs will still fire while the screen is on, and will catch up (play once) when you unlock the phone, but they will not ring at the correct times during screen-off.

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

**AVD (emulator):** `run.sh` targets the Meditation_Phone AVD.

```bash
./run.sh               # full flow: build → sync → install → launch (use after any code change)
./run.sh --skip-build  # re-install existing APK without rebuilding (quicker; only safe when native config unchanged)
./run.sh --stop        # shut down the emulator and web server
```

> **Multi-device note:** `run.sh` detects the emulator serial via `adb devices` and passes `-s <serial>` to all adb commands. This means it works correctly even when a physical phone is also connected via USB.

**Physical phone:** `deploy-phone.sh` targets a real Android device.

```bash
./deploy-phone.sh               # build + deploy to phone
./deploy-phone.sh --skip-build  # re-deploy existing APK without rebuilding
```

It scans connected devices and lets you pick if more than one is found (always prefers physical over emulator). The phone must have USB debugging enabled.

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
    timer.js                    # Timer: wall-clock elapsed time (Date.now()), startTimer / pauseTimer / finishTimer / gong rules; visibilitychange sync for screen-unlock accuracy
    gong.js                     # Gong synthesizer: additive sine waves + Web Audio API envelopes
    background-gong.js          # Background gong: schedules @capacitor/local-notifications when screen locks; cancels when screen unlocks (Web Audio takes over)
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
  service-worker.js             # Offline cache (CACHE_NAME: meditation-timer-v21)
  manifest.json                 # PWA manifest
www/                            # Vite build output — Capacitor webDir. Never edit directly.
android/                        # Capacitor Android wrapper project
  app/src/main/AndroidManifest.xml   # Permissions: Health Connect, SCHEDULE_EXACT_ALARM (background gongs)
  variables.gradle              # SDK versions (compileSdk 36, minSdk 26, targetSdk 36)
```

---

## Testing

```bash
npm test
```

Runs 126 Vitest unit tests covering:
- Date helpers and CSV utilities
- Storage migration (v1 → v2)
- Timer wall-clock accuracy: screen-off throttling, pause/resume, gong catch-up
- Background gong schedule: notification timing, strike gaps, ID uniqueness
- BioMathEngine: settle-time, RSA respiration, `extractRespirationFromHR`, skin temp friction, torpor detection, `classifySession`, `analyzeSession`

Tests run in a Node.js environment (no browser, no Android required).

### Testing background gongs on device

Because this feature depends on the Android alarm system and Doze mode, it can only be meaningfully tested on a real device — not AVD or the web.

**Quick end-to-end test (~5 seconds):**

1. Deploy the APK to your phone and open the app.
2. On your Mac, open `chrome://inspect` and select the app's WebView to get a DevTools console.
3. Tap **Start** in the app.
4. In the DevTools console run: `meditationDebug.setTime(895)` — the timer jumps to 14:55.
5. **Immediately lock the phone** (press power button).
6. Wait 5 seconds — the gong should play through the locked screen.

For the 30-minute mark (2 strikes): use `meditationDebug.setTime(1795)` instead.

**Instant diagnostic (no waiting):**

Start a session, lock the screen, then run on your Mac:

```bash
adb -s <device-serial> shell dumpsys alarm | grep -A8 "com.shyamsuri.meditationtimer"
```

Check logcat for the plugin's fallback warning — its **absence** confirms exact alarms are being used:

```bash
adb -s <device-serial> logcat -s "Capacitor/LocalNotification" | grep -i "exact"
```

Before fix: `"Exact alarms not allowed in user settings. Notification scheduled with non-exact alarm."`
After fix: no output.

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

**Respiration from HR (RSA)** — heart rate rises on inhale and falls on exhale (respiratory sinus arrhythmia). The engine resamples HR to uniform 4 Hz, removes baseline drift (25 s moving average), then finds the dominant oscillation frequency via DFT (Hanning-windowed) with parabolic interpolation in the 0.05–0.6 Hz respiratory band (3–36 br/min). This spectral approach detects breathing rate regardless of RSA amplitude — critical for sparse, pre-averaged Health Connect data where the oscillation may be < 1 bpm.

### Session Quality Tags

After each session with telemetry, one of five quality tags is assigned using a
priority-ordered decision tree (first match wins):

| Tag | What it means |
|---|---|
| **Somnolent** | Likely fell asleep — SpO2 dropped ≥3% (or below 94%) alongside near-zero breathing (< 4 br/min) |
| **Deep Absorption** | Breathing nearly stopped (< 6 br/min) in at least one 30-sec window AND wrist temperature rose (peripheral vasodilation) |
| **Absorbed** | Heart rate settled within 5 minutes of starting |
| **Settling** | Heart rate settled, but took more than 5 minutes |
| **Restless** | Heart rate never stabilised, or no telemetry available |

**"Settled" definition:** HR stays within 5% of the session minimum for ≥60 consecutive seconds
(first 30 s excluded as warm-up noise).

**Respiration source priority:**
1. Direct Health Connect `respiratoryRate` field (high confidence)
2. RSA from RR intervals if HRV ≥ 10 samples (medium confidence)
3. RSA from HR bpm (low confidence, sparse-data fallback)

**RSA algorithm:** resample to 4 Hz → detrend with 25 s moving average → DFT + Hanning window →
parabolic interpolation for sub-bin accuracy → dominant frequency in 0.05–0.6 Hz band (3–36 br/min),
60 s sliding windows with 30 s step. Detects breathing rate regardless of RSA amplitude — critical
for sparse, pre-averaged Health Connect data where oscillations may be < 1 bpm.

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

**Current:** `APP_VERSION = 'v7.16'`, `CACHE_NAME = 'meditation-timer-v26'`

> **Why this matters on device:** The service worker uses a cache-first strategy and caches `index.html` in the WebView. The SW stays alive across APK reinstalls. If `CACHE_NAME` is not bumped, the SW serves the old cached `index.html` and UI changes appear to have no effect — even though `npm run dev` shows them correctly. Bumping `CACHE_NAME` forces the SW to delete the old cache on next activate.

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
