#!/bin/bash
set -e

# Rebuild backend + frontend and restart the single-port dev server
# (backend on :3001 serving the built SPA + socket.io). Run this after
# changing backend or frontend source while the server is running.
#
# Why this exists: with the single-port setup the backend serves the built
# SPA via @fastify/static. A frontend rebuild produces new hashed asset
# filenames; the server snapshots its file map at startup, so brand-new
# assets fell through to the SPA fallback as text/html and the page broke
# until the backend was restarted. backend/src/index.ts now uses
# wildcard: true so new assets are served without a restart, but backend
# source changes still need a rebuild + restart — this script does the whole
# cycle in one command.
#
# Usage:
#   bash scripts/rebuild-restart.sh
# Env overrides: PORT, REDIS_URL, DATABASE_PATH, JWT_SECRET, SERVE_LOG

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3001}"
LOG="${SERVE_LOG:-/tmp/ai-conv-serve.log}"

cd "$PROJECT_ROOT"

echo "=== Killing server on :$PORT ==="
fuser -k "$PORT/tcp" 2>/dev/null || true
sleep 1

echo "=== Rebuilding backend + frontend ==="
npm run build --workspace=backend
npm run build --workspace=frontend

echo "=== Starting backend (single-port, serves SPA) on :$PORT ==="
# REDIS_URL="" (empty) is critical — the default redis://localhost:6379
# triggers Redis connection errors. An explicit empty string makes Redis
# fully optional. Empty DATABASE_PATH/JWT_SECRET fall back to the backend's
# own defaults (persistent secret file next to the DB).
setsid /usr/bin/env \
  PORT="$PORT" \
  REDIS_URL="${REDIS_URL:-}" \
  DATABASE_PATH="${DATABASE_PATH:-}" \
  JWT_SECRET="${JWT_SECRET:-}" \
  PATH=/usr/bin:/usr/local/bin \
  node "$PROJECT_ROOT/backend/dist/index.js" \
  </dev/null >>"$LOG" 2>&1 &
echo "  PID $! — log: $LOG"

for i in $(seq 1 15); do
  if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
    echo "  Health OK — http://localhost:$PORT/"
    exit 0
  fi
  sleep 1
done

echo "  Server did not become healthy — check $LOG" >&2
exit 1
