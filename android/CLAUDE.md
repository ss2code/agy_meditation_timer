# Android — CLAUDE.md

Capacitor-based Android wrapper for the Meditation Timer PWA.

## Workflow

Source files live in the project root (`index.html`, `script.js`, etc.). Capacitor's `webDir` is `www/`. Always copy sources into `www/` before syncing:

```bash
cd ..  # project root
cp index.html script.js style.css service-worker.js manifest.json www/
npx cap sync android
```

Or just use `./run.sh` which does this automatically.

## CLI Build (macOS Sequoia)

macOS Sequoia's `com.apple.provenance` attribute breaks Gradle's daemon forking.
**Always use `--no-daemon`** — this is the fix, not a workaround to remove.

```bash
cd android && \
GRADLE_USER_HOME=/tmp/gradle-home \
./gradlew assembleDebug --no-daemon --project-cache-dir=/tmp/gradle-project-cache
```

`JAVA_HOME` is set globally in `~/.zshrc` (points to Homebrew openjdk@17).

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

## Deploy to AVD ("Meditation Phone")

```bash
# Install
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Launch
adb shell am start -n com.shyamsuri.meditationtimer/.MainActivity
```

Or use `run.sh` from the project root (handles AVD boot + build + install).

## Key Files

- `app/build.gradle` — app config, applicationId `com.shyamsuri.meditationtimer`
- `variables.gradle` — SDK versions (compileSdk=36, minSdk=26, targetSdk=36)
- `local.properties` — `sdk.dir` path (not committed, already present)
- `gradle/wrapper/gradle-wrapper.properties` — Gradle 8.14.3
- `build.gradle` — AGP 8.13.0

## Open in Android Studio

```bash
npx cap open android
```
