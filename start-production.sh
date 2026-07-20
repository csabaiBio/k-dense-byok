#!/usr/bin/env bash
# Production launcher for proxy deployments (e.g., JupyterHub).
# Builds Next.js once (if needed), then runs both services in production mode.
set -e
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
    echo "Node.js not found. Install Node.js >= 22 from https://nodejs.org/" >&2
    exit 1
fi

echo "============================================"
echo "  Kady — Production Mode Startup"
echo "============================================"
echo ""

# Install deps if needed
if [ ! -d "server/node_modules" ] || [ ! -d "web/node_modules" ]; then
    echo "Installing dependencies..."
    npm --prefix server install
    npm --prefix web install
    echo ""
fi

# Prep projects & skills
echo "Preparing projects..."
npm --prefix server run prep --silent || echo "  (skills download skipped/failed — continuing)"
echo ""

# Build frontend if .next doesn't exist or is older than source
if [ ! -d "web/.next" ] || [ "web/src" -nt "web/.next" ]; then
    echo "Building Next.js frontend..."
    npm --prefix web run build
    echo ""
fi

echo "Starting services..."
echo ""

# Start backend
echo "Starting backend on port ${KADY_PORT:-8000}..."
npm --prefix server run start &
BACKEND_PID=$!

# Start frontend in production mode
FRONTEND_PORT=${FRONTEND_PORT:-3000}
echo "Starting frontend on port ${FRONTEND_PORT}..."
npm --prefix web run start -- -p ${FRONTEND_PORT} &
FRONTEND_PID=$!

# Cleanup handler
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    wait
    exit
}

trap cleanup SIGINT SIGTERM SIGHUP

echo ""
echo "============================================"
echo "  Services running in production mode!"
echo "  Backend: http://localhost:${KADY_PORT:-8000}"
echo "  Frontend: http://localhost:${FRONTEND_PORT}"
echo "  Press Ctrl+C to stop"
echo "============================================"

# Wait for services
wait
