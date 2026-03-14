#!/usr/bin/env bash
# run-tests.sh — Test runner for meditation-timer PWA
#
# ENTRY POINT
#   Vitest runs all files matching: src/**/*.test.js  tests/**/*.test.js
#   Config: vitest.config.js (environment: node)
#
# TEST FILES (as of writing)
#   src/utils/csv.test.js
#   src/utils/date-helpers.test.js
#   src/storage/migration.test.js
#   src/timer/timer.test.js
#   src/timer/background-gong.test.js
#   src/bio/bio-math-engine.test.js
#
# USAGE
#   ./run-tests.sh              # run all tests once
#   ./run-tests.sh --watch      # re-run on file changes (dev mode)
#   ./run-tests.sh --filter bio # run only tests matching a pattern (file or test name)
#   ./run-tests.sh --coverage   # run with v8 coverage report
#
# REQUIREMENTS
#   Node.js >= 18, npm >= 9
#   Run `npm install` once before using this script.
#   No native dependencies, no Android SDK, no emulator needed.
#
# PERMISSIONS
#   chmod +x run-tests.sh   (only needed once, already done)

set -euo pipefail

# ── resolve project root (script location, not cwd) ────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── check node_modules present ──────────────────────────────────────────────
if [[ ! -d node_modules ]]; then
  echo "node_modules not found — running npm install first..."
  npm install
fi

# ── parse args ───────────────────────────────────────────────────────────────
WATCH=false
FILTER=""
COVERAGE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch)    WATCH=true;       shift ;;
    --filter)   FILTER="$2";     shift 2 ;;
    --coverage) COVERAGE=true;   shift ;;
    -h|--help)
      sed -n '2,/^set /p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Unknown option: $1  (use --help for usage)" >&2
      exit 1 ;;
  esac
done

# ── build vitest command ─────────────────────────────────────────────────────
CMD=(npx vitest)

if $WATCH; then
  : # vitest defaults to watch mode when not passed 'run'
else
  CMD+=(run)
fi

[[ -n "$FILTER" ]] && CMD+=(-t "$FILTER")
$COVERAGE       && CMD+=(--coverage)

# ── run ──────────────────────────────────────────────────────────────────────
echo "Running: ${CMD[*]}"
echo "──────────────────────────────────────────────────────────────────────"
"${CMD[@]}"
