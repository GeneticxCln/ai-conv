#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Killing existing processes on ports 5173 and 3001 ==="
fuser -k 5173/tcp 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true
sleep 1

echo "=== Starting frontend static server on :5173 ==="
node "$PROJECT_ROOT/scripts/serve-frontend.js" &
FRONTEND_PID=$!
sleep 1

echo "=== Starting backend on :3001 ==="
JWT_SECRET=test-dev \
  DATABASE_PATH="$PROJECT_ROOT/backend/data/ai-conv.db" \
  OLLAMA_HOST=http://localhost:11434 \
  PORT=3001 \
  node "$PROJECT_ROOT/backend/dist/index.js" &
BACKEND_PID=$!
sleep 2

echo "=== Health check ==="
curl -s http://localhost:3001/health && echo ""
curl -s -o /dev/null -w "Frontend: HTTP %{http_code}\n" http://localhost:5173/

echo ""
echo "=== Services running ==="
echo "  Frontend: http://localhost:5173 (PID $FRONTEND_PID)"
echo "  Backend:  http://localhost:3001 (PID $BACKEND_PID)"
echo "  Socket:   http://localhost:3001/socket.io"
echo ""

if [ "$1" = "--electron" ]; then
  echo "=== Launching Electron ==="
  cd "$PROJECT_ROOT/frontend" && npx electron . --no-sandbox &
fi

echo "Press Ctrl+C to stop all services"
wait
