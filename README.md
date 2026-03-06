# Calm Meditation Timer

A simple, beautiful meditation timer that tracks your sessions and provides gentle gong sounds to keep you focused.

## Features

- **Clean Interface**: Distraction-free design with a soothing color palette.
- **Meditation History**: Locally saves your sessions and displays recent history and insights (Today, Week, Month).
- **Gong Sounds**:
    - **Initial Gong**: Rings once after **15 seconds** to signal the settling-in period.
    - **Interval Gong**: Rings every **15 minutes** (900 seconds). The number of strikes corresponds to the number of 15-minute intervals completed (e.g., 1 strike at 15m, 2 strikes at 30m, etc.).
- **PWA Support**: Installable as an app on iOS, Android, and Desktop. Works offline.

## How to Use

1.  **Start**: Click the **Start** button to begin the timer. This will also initialize the audio engine slightly before the first sound is needed.
2.  **Pause**: Click **Pause** to temporarily stop the timer.
3.  **Finish/Reset**:
    - If the timer is running or paused with time elapsed, clicking **Finish** saves the session to your history.
    - If the timer is at 00:00, it resets the state.
4.  **Audio**: Ensure your device volume is up. The sounds are synthesized programmatically, so no downloads are required.

## Installation (PWA)

### iOS (iPhone/iPad)
1.  Open the site in **Safari**.
2.  Tap the **Share** button (box with an arrow).
3.  Scroll down and tap **Add to Home Screen**.
4.  Launch the app from your home screen for a full-screen experience.

### Android (Chrome)
1.  Open the site in **Chrome**.
2.  Tap the menu (three dots) or look for the "Add to Home Screen" banner at the bottom.
3.  Tap **Install**.

### Desktop (Chrome/Edge)
1.  Look for the install icon (usually a monitor with a down arrow) in the address bar.
2.  Click it to install as a standalone application.

## Technical Details

- **Stack**: Vanilla HTML, CSS, and JavaScript.
- **Audio**: Uses the **Web Audio API** to synthesize gong sounds in real-time using additive synthesis (sine waves + envelopes + filters). This ensures zero latency and works without external assets.
- **Offline**: Uses a Service Worker to cache all necessary files (`index.html`, `style.css`, `script.js`, `manifest.json`).

## Versioning & Updates

The current version is displayed at the bottom of the main screen.

When making changes, always update all three together:
1.  Bump `APP_VERSION` in `script.js`.
2.  Bump `CACHE_NAME` in `service-worker.js`.
3.  Update the script query param in `index.html` (e.g., `script.js?v=X`).

## Development

### Prerequisites

Install these once before your first session:

1. **Node.js** — for `npx` commands
2. **Java 17** via Homebrew:
   ```bash
   brew install openjdk@17
   ```
3. **Android Studio** — download from [developer.android.com/studio](https://developer.android.com/studio). During setup, install the Android SDK and create an AVD named **`Meditation_Phone`**.
4. **Shell environment** — add the following to `~/.zshrc`:
   ```bash
   export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
   export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
   ```
   Then reload: `source ~/.zshrc`

### Session Workflow

All dev tasks go through `run.sh`. It is idempotent — safe to re-run at any point.

**Start of session** — boots the AVD, builds, and launches the app:
```bash
./run.sh
```

**After changing JS/CSS/HTML** — rebuild and re-deploy (~2.5 min):
```bash
./run.sh
```

**After changing JS/CSS/HTML, when AVD + web server are already running** — skip the slow Gradle build:

> Use this only if you haven't changed native Android config. When in doubt, use `./run.sh`.

```bash
./run.sh --skip-build
```

**End of session** — shuts down the emulator, web server, and cleans up Gradle temp files:
```bash
./run.sh --stop
```

### What `run.sh` Does

| Step | Action | Skipped when |
|------|--------|-------------|
| 1 | Start `http-server` on `:8080` | Already running |
| 2 | Boot "Meditation Phone" AVD | Already running |
| 3 | Copy source files → `www/` | `--skip-build` |
| 4 | `npx cap sync android` | `--skip-build` |
| 5 | `./gradlew assembleDebug` | `--skip-build` |
| 6 | Force-stop old app instance | — |
| 7 | `adb install` + launch | — |

> **Source vs staging:** Edit files in the project root (`script.js`, `index.html`, etc.). The `www/` directory is a Capacitor staging folder — `run.sh` copies root sources into it automatically before every build. Never edit `www/` directly.

### macOS Sequoia Note

`--no-daemon` is always passed to Gradle. This is required on macOS Sequoia — the `com.apple.provenance` sandbox attribute prevents Gradle's forked daemon workers from writing build artifacts. Running without a daemon (single process) is the fix.

