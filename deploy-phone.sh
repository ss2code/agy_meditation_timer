#!/usr/bin/env bash
# deploy-phone.sh — Build APK and deploy to a physical Android device.
#
# Usage:
#   ./deploy-phone.sh               Build + deploy
#   ./deploy-phone.sh --skip-build  Deploy existing APK without rebuilding
set -euo pipefail

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
APP_ID="com.shyamsuri.meditationtimer"
APK="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[deploy]${RESET} $*"; }
success() { echo -e "${GREEN}[deploy]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${RESET} $*"; }
error()   { echo -e "${RED}[deploy]${RESET} $*"; exit 1; }

# ── Prerequisites ──────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Before continuing, make sure:${RESET}"
echo "  1. USB cable is plugged in (phone → Mac)"
echo "  2. Phone screen is unlocked"
echo "  3. Tap 'Allow' on the 'Allow USB debugging?' dialog if it appears"
echo "  4. Auto Blocker is OFF: Settings → Security and privacy → Auto Blocker"
echo ""
read -rp "Press Enter when ready..."
echo ""

# ── Device selection ───────────────────────────────────────────────────────────
info "Scanning for connected devices..."
sleep 1   # give adb a moment after any just-connected cable

# Collect all 'device' lines (excludes 'offline', 'unauthorized')
ALL_LINES=()
while IFS= read -r line; do
  ALL_LINES+=("$line")
done < <("$ADB" devices 2>/dev/null | tail -n +2 | grep -w "device" || true)

if [ ${#ALL_LINES[@]} -eq 0 ]; then
  error "No authorized devices found. Check the USB debugging prompt on your phone."
fi

# Separate physical devices (no 'emulator-' prefix) from emulators
PHYSICAL=()
EMULATORS=()
for line in ${ALL_LINES[@]+"${ALL_LINES[@]}"}; do
  serial=$(echo "$line" | awk '{print $1}')
  if [[ "$serial" == emulator-* ]]; then
    EMULATORS+=("$serial")
  else
    PHYSICAL+=("$serial")
  fi
done

# Build candidate list: physical devices first, then emulators
# Safe expansion for bash 3.2 (macOS default): ${arr[@]+"${arr[@]}"} handles empty arrays with set -u
CANDIDATES=(
  ${PHYSICAL[@]+"${PHYSICAL[@]}"}
  ${EMULATORS[@]+"${EMULATORS[@]}"}
)

if [ ${#CANDIDATES[@]} -eq 1 ]; then
  DEVICE="${CANDIDATES[0]}"
  if [[ "$DEVICE" == emulator-* ]]; then
    warn "Only device found is an emulator ($DEVICE). Use run.sh for AVD workflows."
    read -rp "Continue anyway? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
  else
    info "Using device: $DEVICE"
  fi
else
  echo -e "${CYAN}Connected devices:${RESET}"
  for i in "${!CANDIDATES[@]}"; do
    serial="${CANDIDATES[$i]}"
    label=""
    if [[ "$serial" == emulator-* ]]; then
      label=" ${YELLOW}(emulator)${RESET}"
    else
      # Try to get the friendly model name
      model=$("$ADB" -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || echo "")
      [ -n "$model" ] && label=" ${GREEN}($model)${RESET}"
    fi
    echo -e "  $((i+1))) $serial$label"
  done
  echo ""

  # Default to first physical device if any
  DEFAULT=1
  read -rp "Select device [default: $DEFAULT]: " choice
  choice="${choice:-$DEFAULT}"

  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#CANDIDATES[@]}" ]; then
    error "Invalid selection: $choice"
  fi
  DEVICE="${CANDIDATES[$((choice-1))]}"
fi

echo ""
info "Target: $DEVICE"
echo ""

# ── Build ──────────────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  info "Building web bundle with Vite..."
  cd "$PROJECT_ROOT"
  npm run build
  success "www/ updated"

  info "Syncing Capacitor..."
  npx cap sync android 2>&1 | grep -E "✔|error|warn" || true

  info "Building APK (--no-daemon required on macOS Sequoia)..."
  cd "$PROJECT_ROOT/android"
  GRADLE_USER_HOME=/tmp/gradle-home \
    ./gradlew assembleDebug --no-daemon --project-cache-dir=/tmp/gradle-project-cache \
    --quiet 2>&1 | tail -5
  success "APK built → $APK"
else
  if [ ! -f "$APK" ]; then
    error "No APK found at $APK — run without --skip-build first."
  fi
  warn "Build skipped (--skip-build)"
fi

# ── Deploy ─────────────────────────────────────────────────────────────────────
info "Force-stopping any running instance..."
"$ADB" -s "$DEVICE" shell am force-stop "$APP_ID" 2>/dev/null || true

info "Installing APK on $DEVICE..."
"$ADB" -s "$DEVICE" install -r "$APK" 2>&1 | grep -v "^$"

info "Launching $APP_ID..."
"$ADB" -s "$DEVICE" shell am start -n "$APP_ID/.MainActivity"

echo ""
success "App deployed and launched on $DEVICE"
echo ""
echo -e "  ${CYAN}Tip:${RESET} Next time, use --skip-build to re-deploy without rebuilding."
echo ""
