#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "============================================"
echo "  Kady — Starting up"
echo "============================================"
echo

# Best-effort: raise soft FD limit to reduce watcher failures on low-limit hosts.
CURRENT_NOFILE="$(ulimit -Sn 2>/dev/null || echo 0)"
HARD_NOFILE="$(ulimit -Hn 2>/dev/null || echo 0)"
TARGET_NOFILE=65535
if [[ "$HARD_NOFILE" =~ ^[0-9]+$ ]] && (( HARD_NOFILE > 0 && HARD_NOFILE < TARGET_NOFILE )); then
  TARGET_NOFILE="$HARD_NOFILE"
fi
if [[ "$CURRENT_NOFILE" =~ ^[0-9]+$ ]] && (( CURRENT_NOFILE > 0 && CURRENT_NOFILE < TARGET_NOFILE )); then
  if ulimit -Sn "$TARGET_NOFILE" 2>/dev/null; then
    echo "Raised open file limit: $CURRENT_NOFILE -> $TARGET_NOFILE"
  else
    echo "Warning: could not raise open file limit (current: $CURRENT_NOFILE, hard: $HARD_NOFILE)."
    echo "If you see fsnotify/EMFILE errors, increase limits (ulimit/sysctl) on this host."
  fi
fi

# ---- Step 3: Load environment variables ----

echo "Loading environment from kady_agent/.env..."
set -a
source kady_agent/.env
set +a

normalize_frontend_prefix() {
  local raw="$1"
  raw="${raw%/}"
  if [[ -z "$raw" || "$raw" == "/" ]]; then
    echo ""
  elif [[ "$raw" == /* ]]; then
    echo "$raw"
  else
    echo "/$raw"
  fi
}

FRONTEND_PREFIX="$(normalize_frontend_prefix "${FRONTEND_URL_PREFIX:-}")"
if [[ -n "${FRONTEND_URL:-}" ]]; then
  UI_URL="$FRONTEND_URL"
else
  UI_URL="http://localhost:3000${FRONTEND_PREFIX}"
fi

# ---- Step 4: Prepare the sandbox ----

echo "Preparing sandbox (creates sandbox/ dir, downloads scientific skills from K-Dense)..."
#uv run python prep_sandbox.py

echo

# ---- Step 5: Start all services ----

echo "Starting services..."
echo

echo "  → LiteLLM proxy on port 4000 (routes LLM calls to OpenRouter)"
uv run litellm --config litellm_config.yaml --port 4000 &
LITELLM_PID=$!
sleep 2

echo "  → Backend on port 8181 (FastAPI + ADK agent)"
# Restrict the reload watcher to kady_agent/ so that writes inside sandbox/
# (done by the Gemini CLI subprocess during delegate_task) do NOT cause
# uvicorn to shut down mid-stream and stall /sandbox/* endpoints.
# Note: edits to server.py require a manual restart of this script.
#uv run uvicorn server:app --reload --reload-dir kady_agent --port 8181 &
uv run uvicorn server:app --port 8181 &
BACKEND_PID=$!

echo "  → Frontend on port 3000 (Next.js UI)"
(
  cd web
  NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}" \
  WATCHPACK_POLLING="${WATCHPACK_POLLING:-true}" \
  WATCHPACK_POLLING_INTERVAL="${WATCHPACK_POLLING_INTERVAL:-1000}" \
  npm run dev --host
) &
FRONTEND_PID=$!

echo
echo "============================================"
echo "  All services running!"
echo "  UI: $UI_URL"
if command -v open &>/dev/null || command -v xdg-open &>/dev/null; then
  echo "  Opening that URL in your default browser in a few seconds…"
fi
echo "  Press Ctrl+C to stop everything"
echo "============================================"

# Give Next.js a moment to bind, then open the app (non-blocking)
(
  sleep 3
  if command -v open &>/dev/null; then
    open "$UI_URL"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$UI_URL" &>/dev/null
  fi
) &

trap "kill $LITELLM_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
