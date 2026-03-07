#!/usr/bin/env bash
# run.sh — Manage the Meditation Timer dev environment.
#
# Usage:
#   ./run.sh               Full flow: sync + build + install + launch on AVD
#   ./run.sh --skip-build  Re-install existing APK without rebuilding
#   ./run.sh --stop        Shut down everything and clean up temp files
set -euo pipefail

SKIP_BUILD=false
STOP=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --stop)       STOP=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
AVD_NAME="Meditation_Phone"
APP_ID="com.shyamsuri.meditationtimer"
APK="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
WEB_PORT=8080

# ── Colours ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[run]${RESET} $*"; }
success() { echo -e "${GREEN}[run]${RESET} $*"; }
skip()    { echo -e "${YELLOW}[run]${RESET} $*"; }

# ══════════════════════════════════════════════════════════════════════════════
# STOP mode
# ══════════════════════════════════════════════════════════════════════════════
if [ "$STOP" = true ]; then
  echo -e "${CYAN}[run]${RESET} Shutting down …"

  # Stop the Android emulator
  if "$ADB" devices 2>/dev/null | grep -q "^emulator"; then
    info "Stopping Android emulator …"
    "$ADB" emu kill 2>/dev/null || true
    sleep 2
    success "Emulator stopped"
  else
    skip "Emulator not running"
  fi

  # Stop the web server
  WEB_PID=$(lsof -ti ":$WEB_PORT" 2>/dev/null || true)
  if [ -n "$WEB_PID" ]; then
    info "Stopping http-server (pid $WEB_PID) …"
    kill "$WEB_PID" 2>/dev/null || true
    success "Web server stopped"
  else
    skip "Web server not running"
  fi

  # Clean up Gradle temp directories
  info "Cleaning Gradle temp caches …"
  rm -rf /tmp/gradle-home /tmp/gradle-project-cache
  success "Cleaned /tmp/gradle-home and /tmp/gradle-project-cache"

  echo ""
  echo -e "${GREEN}All done. Session ended cleanly.${RESET}"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# START mode
# ══════════════════════════════════════════════════════════════════════════════

# ── 1. Web server ───────────────────────────────────────────────────────────────
if lsof -ti ":$WEB_PORT" &>/dev/null; then
  skip "http-server already on :$WEB_PORT"
else
  info "Starting http-server on :$WEB_PORT …"
  npx http-server "$PROJECT_ROOT/www" -p $WEB_PORT --silent &
  success "Web server started → http://localhost:$WEB_PORT (serving www/)"
fi

# ── 2. Android emulator (AVD) ──────────────────────────────────────────────────
if "$ADB" devices 2>/dev/null | grep -q "^emulator"; then
  skip "Android emulator already running"
else
  info "Booting AVD '$AVD_NAME' …"
  "$EMULATOR" -avd "$AVD_NAME" -no-snapshot-load &
  info "Waiting for emulator to come online …"
  "$ADB" wait-for-device
  until [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
    sleep 2
  done
  success "Emulator '$AVD_NAME' is ready"
fi

# ── 3. Build web sources into www/ via Vite, then cap sync ────────────────────
if [ "$SKIP_BUILD" = false ]; then
  info "Building web sources with Vite into www/ …"
  cd "$PROJECT_ROOT"
  npm run build
  success "www/ is up to date"

  info "Syncing Capacitor assets …"
  npx cap sync android 2>&1 | grep -E "✔|error|warn" || true
fi

# ── 4. Build Android APK ───────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = true ]; then
  skip "Gradle build skipped (--skip-build)"
  if [ ! -f "$APK" ]; then
    echo "ERROR: No APK found at $APK — run without --skip-build first." >&2
    exit 1
  fi
else
  info "Building APK (--no-daemon required on macOS Sequoia) …"
  cd "$PROJECT_ROOT/android"
  GRADLE_USER_HOME=/tmp/gradle-home \
    ./gradlew assembleDebug --no-daemon --project-cache-dir=/tmp/gradle-project-cache \
    --quiet 2>&1 | tail -5
  success "APK built → $APK"
fi

# ── 5. Force-stop any running instance ─────────────────────────────────────────
"$ADB" shell am force-stop "$APP_ID" 2>/dev/null || true

# ── 6. Install & launch ────────────────────────────────────────────────────────
info "Installing APK …"
"$ADB" install -r "$APK" 2>&1 | grep -v "^$"

# Clear app data so stale service-worker cache is wiped on every deploy
info "Clearing app data (WebView SW cache, localStorage) …"
"$ADB" shell pm clear "$APP_ID" 2>/dev/null || true

info "Launching $APP_ID …"
"$ADB" shell am start -n "$APP_ID/.MainActivity"
success "App launched on '$AVD_NAME'"

echo ""
echo -e "${GREEN}All done.${RESET}"
echo "  Web:     http://localhost:$WEB_PORT"
echo "  Android: $APP_ID running on $AVD_NAME"
echo ""
echo "  When finished: ./run.sh --stop"
