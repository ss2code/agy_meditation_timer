#!/usr/bin/env bash
# run.sh — prj_meditation_tmr dispatcher (Capacitor PWA + Android wrapper)
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# shellcheck disable=SC1091
source "$(cd "$PROJECT_ROOT/.." && pwd)/scripts/regression_helpers.sh"

usage() {
  cat <<'EOF'
prj_meditation_tmr — Meditation Timer (Vite PWA + Capacitor Android wrapper)

Usage:
  ./run.sh                       Full flow: build web + APK + install + launch on AVD
  ./run.sh --skip-build          Re-install existing APK without rebuilding
  ./run.sh --stop                Shut down emulator + clean per-project Gradle cache
  ./run.sh --dev                 Vite dev server on http://localhost:5173
  ./run.sh --test                Vitest suite (npm test)
  ./run.sh --regression          npm test + ./gradlew assembleDebug (no emulator)
  ./run.sh --help                This help

Notes:
  Full flow needs an AVD named 'Meditation_Phone' and Android SDK at ANDROID_HOME.
  Regression intentionally skips emulator boot — boot is slow/flaky in a sweep.
EOF
}

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
AVD_NAME="Meditation_Phone"
APP_ID="com.shyamsuri.meditationtimer"
APK="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
GRADLE_HOME_DIR="$PROJECT_ROOT/.gradle-home"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[run]${RESET} $*"; }
success() { echo -e "${GREEN}[run]${RESET} $*"; }
skip()    { echo -e "${YELLOW}[run]${RESET} $*"; }

cmd_stop() {
  echo -e "${CYAN}[run]${RESET} Shutting down …"
  if "$ADB" devices 2>/dev/null | grep -q "^emulator"; then
    info "Stopping Android emulator …"
    "$ADB" emu kill 2>/dev/null || true
    sleep 2
    success "Emulator stopped"
  else
    skip "Emulator not running"
  fi
  info "Cleaning Gradle project cache …"
  rm -rf /tmp/gradle-project-cache
  success "Cleaned /tmp/gradle-project-cache"
  echo ""
  echo -e "${GREEN}All done. Session ended cleanly.${RESET}"
}

cmd_full_flow() {
  local SKIP_BUILD=false
  for arg in "$@"; do
    case "$arg" in
      --skip-build) SKIP_BUILD=true ;;
      *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
  done

  # ── 1. Emulator ──
  if "$ADB" devices 2>/dev/null | grep -q "^emulator"; then
    skip "Android emulator already running"
  else
    info "Booting AVD '$AVD_NAME' …"
    "$EMULATOR" -avd "$AVD_NAME" -no-snapshot-load &
    info "Waiting for emulator …"
    "$ADB" wait-for-device
    until [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
      sleep 2
    done
    success "Emulator '$AVD_NAME' is ready"
  fi

  EMULATOR_SERIAL=$("$ADB" devices 2>/dev/null | grep "^emulator" | awk '{print $1}' | head -1)
  if [ -z "$EMULATOR_SERIAL" ]; then
    echo "ERROR: Could not find a running emulator." >&2; exit 1
  fi
  info "Targeting emulator: $EMULATOR_SERIAL"

  # ── 2. Build web + Capacitor sync ──
  if [ "$SKIP_BUILD" = false ]; then
    info "Building web sources with Vite …"
    npm run build
    success "www/ is up to date"
    info "Syncing Capacitor …"
    npx cap sync android 2>&1 | grep -E "✔|error|warn" || true
  fi

  # ── 3. APK ──
  if [ "$SKIP_BUILD" = true ]; then
    skip "Gradle build skipped (--skip-build)"
    [ ! -f "$APK" ] && { echo "ERROR: No APK at $APK" >&2; exit 1; }
  else
    info "Building APK (--no-daemon required on macOS Sequoia) …"
    cd "$PROJECT_ROOT/android"
    GRADLE_USER_HOME="$GRADLE_HOME_DIR" \
      ./gradlew assembleDebug --no-daemon --project-cache-dir=/tmp/gradle-project-cache \
      --quiet 2>&1 | tail -5
    success "APK built → $APK"
    cd "$PROJECT_ROOT"
  fi

  # ── 4. Install + launch ──
  "$ADB" -s "$EMULATOR_SERIAL" shell am force-stop "$APP_ID" 2>/dev/null || true
  info "Installing APK …"
  "$ADB" -s "$EMULATOR_SERIAL" install -r "$APK" 2>&1 | grep -v "^$"
  info "Clearing app data (WebView SW cache) …"
  "$ADB" -s "$EMULATOR_SERIAL" shell pm clear "$APP_ID" 2>/dev/null || true
  info "Launching $APP_ID …"
  "$ADB" -s "$EMULATOR_SERIAL" shell am start -n "$APP_ID/.MainActivity"
  success "App launched on '$AVD_NAME'"
  echo ""
  echo -e "${GREEN}All done.${RESET}"
  echo "  Android: $APP_ID running on $AVD_NAME"
  echo "  When finished: ./run.sh --stop"
}

cmd_dev() { exec npm run dev; }
cmd_test() { exec npm test; }

cmd_regression() {
  local start=$(date +%s)
  local steps=()
  local fail=0

  # Make sure node deps are installed so vitest is on PATH
  if [[ ! -d node_modules ]]; then
    echo "[regression] npm install (first run only)..."
    npm install --silent
  fi

  echo "[regression] npm test (Vitest)..."
  if npm test --silent; then steps+=("vitest:PASS"); else steps+=("vitest:FAIL"); fail=1; fi

  # Find a usable Android SDK or SKIP the build step
  local sdk_dir=""
  if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
    sdk_dir="${ANDROID_HOME}"
  elif [[ -n "${ANDROID_SDK_ROOT:-}" && -d "${ANDROID_SDK_ROOT}" ]]; then
    sdk_dir="${ANDROID_SDK_ROOT}"
  elif [[ -f "$PROJECT_ROOT/android/local.properties" ]]; then
    local p="$(awk -F= '/^sdk.dir=/ {print $2}' "$PROJECT_ROOT/android/local.properties" | head -1)"
    [[ -d "$p" ]] && sdk_dir="$p"
  fi
  if [[ -z "$sdk_dir" ]] && [[ -d "$HOME/Library/Android/sdk" ]]; then
    sdk_dir="$HOME/Library/Android/sdk"
  fi
  if [[ -z "$sdk_dir" ]]; then
    steps+=("assembleDebug:SKIP(no-sdk)")
  else
    export ANDROID_HOME="$sdk_dir" ANDROID_SDK_ROOT="$sdk_dir"
    echo "[regression] gradle assembleDebug (no emulator)..."
    ( cd "$PROJECT_ROOT/android" \
        && GRADLE_USER_HOME="$GRADLE_HOME_DIR" \
           ./gradlew assembleDebug --no-daemon --project-cache-dir=/tmp/gradle-project-cache --quiet )
    if [[ $? -eq 0 ]]; then steps+=("assembleDebug:PASS"); else steps+=("assembleDebug:FAIL"); fail=1; fi
  fi

  local dur=$(( $(date +%s) - start ))
  if [[ $fail -eq 0 ]]; then
    write_regression_report "PASS" "${steps[*]}" "$dur"
    return 0
  else
    write_regression_report "FAIL" "${steps[*]}" "$dur"
    return 1
  fi
}

case "${1:-}" in
  --stop|stop) cmd_stop ;;
  --dev|dev) cmd_dev ;;
  --test|test) cmd_test ;;
  --regression|regression) cmd_regression ;;
  --help|-h|help) usage ;;
  *) cmd_full_flow "$@" ;;
esac
