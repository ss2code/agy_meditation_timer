# Android — CLAUDE.md
**Doc Status:** Current Reference


Capacitor Android wrapper for the Meditation Timer web app.

## Source of truth

Web app sources live in project root (`src/`, `index.html`, `public/`).
Do not edit `android/app/src/main/assets/public` directly; regenerate via build/sync.

## Standard Android build flow

From project root:

```bash
npm run build
npx cap sync android
cd android
GRADLE_USER_HOME="../.gradle-home" ./gradlew assembleDebug --no-daemon --project-cache-dir=/tmp/gradle-project-cache
```

APK output:
`android/app/build/outputs/apk/debug/app-debug.apk`

## Preferred scripts

Use project scripts unless you are debugging a specific Android-only issue:

```bash
./run.sh               # emulator workflow
./run.sh --skip-build
./run.sh --stop

./deploy-phone.sh      # physical device workflow
./deploy-phone.sh --skip-build
```

## Sequoia note

On macOS Sequoia, keep `--no-daemon` for Gradle commands.

## Key Android files

- `android/app/src/main/AndroidManifest.xml`
  - includes exact-alarm and foreground-service related permissions used by background gong flow
- `android/variables.gradle`
  - SDK levels and shared Android config
- `android/app/build.gradle`
  - app module config and dependencies

## Open in Android Studio

```bash
npx cap open android
```
