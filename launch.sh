#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "============================================"
echo "  Kady — Starting up"
echo "============================================"
echo

# ---- Step 3: Load environment variables ----

echo "Loading environment from kady_agent/.env..."
set -a
source kady_agent/.env
set +a

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
uv run uvicorn server:app --reload --reload-dir kady_agent --port 8181 &
BACKEND_PID=$!

echo "  → Frontend on port 3000 (Next.js UI)"
cd web && npm run dev &
FRONTEND_PID=$!

echo
echo "============================================"
echo "  All services running!"
echo "  UI: http://localhost:3000"
if command -v open &>/dev/null || command -v xdg-open &>/dev/null; then
  echo "  Opening that URL in your default browser in a few seconds…"
fi
echo "  Press Ctrl+C to stop everything"
echo "============================================"

# Give Next.js a moment to bind, then open the app (non-blocking)
(
  sleep 3
  if command -v open &>/dev/null; then
    open "http://localhost:3000"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:3000" &>/dev/null
  fi
) &

trap "kill $LITELLM_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
