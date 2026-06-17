#!/usr/bin/env bash
# Run all k6 smoke scripts and save summaries under plan/load-tests/baselines/results/
#
# Usage:
#   ./plan/load-tests/run-baseline.sh localhost
#   ./plan/load-tests/run-baseline.sh production
#   npm run test:load:baseline:localhost
#   npm run test:load:baseline:production
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load simple KEY=value lines without shell-evaluating cookie payloads
load_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    [[ "$line" != *=* ]] && continue
    local key="${line%%=*}"
    local val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    val="${val#"${val%%[![:space:]]*}"}"
    case "$key" in
      BASE_URL|TEST_EMAIL|TEST_PASSWORD|BASELINE_TARGET)
        export "$key=$val"
        ;;
    esac
  done < "$file"
}

TARGET="${1:-${BASELINE_TARGET:-localhost}}"
case "$TARGET" in
  localhost|local)
    TARGET="localhost"
    ENV_FILE="$SCRIPT_DIR/.env.localhost"
    COOKIE_FILE="$SCRIPT_DIR/auth-cookie.localhost.txt"
    DEFAULT_URL="http://localhost:3000"
    ;;
  production|prod)
    TARGET="production"
    ENV_FILE="$SCRIPT_DIR/.env.production"
    COOKIE_FILE="$SCRIPT_DIR/auth-cookie.production.txt"
    DEFAULT_URL=""
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    echo "Usage: $0 [localhost|production]" >&2
    exit 1
    ;;
esac

load_env_file "$ENV_FILE"
if [ ! -f "$ENV_FILE" ] && [ -f "$SCRIPT_DIR/.env" ]; then
  load_env_file "$SCRIPT_DIR/.env"
fi

BASE_URL="${BASE_URL:-$DEFAULT_URL}"
if [ -z "$BASE_URL" ]; then
  echo "BASE_URL is required for production. Set it in $ENV_FILE" >&2
  exit 1
fi

if [ -f "$COOKIE_FILE" ]; then
  AUTH_COOKIE="$(tr -d '\n\r' < "$COOKIE_FILE" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  export AUTH_COOKIE
elif [ -z "${AUTH_COOKIE:-}" ]; then
  echo "Missing auth cookie." >&2
  echo "Create $COOKIE_FILE with one line (full Cookie header from DevTools)." >&2
  echo "See auth-cookie.${TARGET}.example.txt" >&2
  exit 1
fi

RUN_DATE="$(date +%Y-%m-%d)"
OUT_DIR="$SCRIPT_DIR/baselines/results/$TARGET/$RUN_DATE"
if [ -d "$OUT_DIR" ]; then
  OUT_DIR="$SCRIPT_DIR/baselines/results/$TARGET/${RUN_DATE}-$(date +%H%M%S)"
fi

mkdir -p "$OUT_DIR"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 not found. Install: https://k6.io/docs/get-started/installation/" >&2
  exit 1
fi

export BASE_URL

GIT_SHA="unknown"
GIT_BRANCH="unknown"
if git -C "$REPO_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
  GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  GIT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
fi

K6_VERSION="$(k6 version 2>/dev/null | head -1 || echo unknown)"
RUN_ID="$(basename "$OUT_DIR")"

cat > "$OUT_DIR/manifest.json" <<EOF
{
  "runId": "$RUN_ID",
  "target": "$TARGET",
  "recordedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "baseUrl": "$BASE_URL",
  "gitSha": "$GIT_SHA",
  "gitBranch": "$GIT_BRANCH",
  "k6Version": "$K6_VERSION",
  "scripts": ["dashboard", "assets-list", "auth-check-session", "verify-pin-smoke"]
}
EOF

echo "→ Target environment: $TARGET"
echo "→ BASE_URL: $BASE_URL"
echo "→ Auth cookie: ${#AUTH_COOKIE} chars from $(basename "$COOKIE_FILE")"
echo "→ Output: $OUT_DIR"
echo

SCRIPTS=(dashboard assets-list auth-check-session verify-pin-smoke)
K6_FAILURES=0

for name in "${SCRIPTS[@]}"; do
  echo "━━━ k6: $name ━━━"
  if k6 run "$SCRIPT_DIR/${name}.js" \
    --summary-export "$OUT_DIR/${name}.summary.json" \
    --out "json=$OUT_DIR/${name}.raw.json" \
    2>&1 | tee "$OUT_DIR/${name}.log"; then
    :
  else
    K6_FAILURES=$((K6_FAILURES + 1))
    echo "⚠ k6 reported threshold failures for $name (results still saved)" >&2
  fi
  echo
done

node "$SCRIPT_DIR/generate-report.mjs" "$OUT_DIR"

echo "✓ Baseline saved to $OUT_DIR"
if [ "$K6_FAILURES" -gt 0 ]; then
  echo "⚠ $K6_FAILURES script(s) failed thresholds — check *.log (often 401 = bad/missing cookie)" >&2
fi
echo "  Compare: node plan/load-tests/compare-baselines.mjs \\"
echo "    plan/load-tests/baselines/results/$TARGET/<older-run> \\"
echo "    plan/load-tests/baselines/results/$TARGET/$RUN_ID"

exit 0
