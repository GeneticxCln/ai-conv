#!/usr/bin/env bash
# Build the Tauri desktop shell end-to-end:
#   1. Frontend → frontend/dist-tauri (never touches dist/, where the
#      Electron app lives)
#   2. Backend sidecar binary + resources (pkg launcher + backend bundle +
#      frontend copy for single-port serving)
#   3. Rust release build (sidecar found via src-tauri/binaries + resources)
#
# Usage: bash src-tauri/build-tauri.sh [--skip-frontend] [--skip-sidecar] [--cli] [--no-bundle] [--no-updater] [--verbose]
#   --cli       Final build via `tauri build` (signs updater artifacts; requires
#               TAURI_SIGNING_PRIVATE_KEY[_PASSWORD] env) instead of plain cargo.
#   --no-bundle With --cli: skip OS installers, just build + sign the binary.
#   --no-updater With --cli: build unsigned OS installers and skip updater
#               artifacts. Used by the GitHub mirror, which has no signing key;
#               GitLab remains the signed updater source.
#   --verbose   With --cli: pass `--verbose` to the Tauri CLI. The AppImage step
#               reports a bare "failed to run linuxdeploy"; verbose is what
#               surfaces the child process error.
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_FRONTEND=false
SKIP_SIDECAR=false
USE_TAURI_CLI=false
NO_BUNDLE=false
NO_UPDATER=false
VERBOSE=false
for arg in "$@"; do
  case "$arg" in
    --skip-frontend) SKIP_FRONTEND=true ;;
    --skip-sidecar) SKIP_SIDECAR=true ;;
    --cli) USE_TAURI_CLI=true ;;
    --no-bundle) NO_BUNDLE=true ;;
    --no-updater) NO_UPDATER=true ;;
    --verbose) VERBOSE=true ;;
  esac
done

if [ "$NO_UPDATER" = true ] && [ "$USE_TAURI_CLI" = false ]; then
  echo "--no-updater only applies with --cli" >&2
  exit 2
fi

if [ "$SKIP_FRONTEND" = false ]; then
  echo "=== [1/3] frontend → dist-tauri ==="
  # VITE_API_URL / VITE_WS_URL are explicitly EMPTIED: the desktop webview
  # loads the app from the backend itself, so everything must resolve to
  # window.location.origin. If a root .env or shell env defines those vars,
  # Vite would bake a literal http://localhost:3001 into the bundle at build
  # time (defeating the fallback and breaking IPv6/hostname cases).
  VITE_OUT_DIR=dist-tauri VITE_API_URL= VITE_WS_URL= \
    npm run build --workspace=packages/types
  VITE_OUT_DIR=dist-tauri VITE_API_URL= VITE_WS_URL= \
    npm run build --workspace=frontend
fi

if [ "$SKIP_SIDECAR" = false ]; then
  echo "=== [2/3] backend sidecar + resources ==="
  # The sidecar build reuses frontend/resources/backend (bundle-backend.cjs
  # output). Rebundle only when missing.
  # bundle-backend.cjs copies backend/dist into the resources bundle, so the
  # backend must be compiled first — on a fresh clone it isn't.
  if [ ! -d backend/dist ]; then
    echo "(backend/dist missing — building packages/types + backend)"
    npm run build --workspace=packages/types
    npm run build --workspace=backend
  fi
  if [ ! -f frontend/resources/backend/dist/index.js ]; then
    echo "(backend bundle missing — running bundle-backend.cjs)"
    node frontend/scripts/bundle-backend.cjs
  fi
  (cd sidecar && node build.js)
fi

echo "=== [3/3] rust release build ==="
if [ "$USE_TAURI_CLI" = true ]; then
  # tauri build ALSO signs updater artifacts when TAURI_SIGNING_PRIVATE_KEY is
  # set (docs/releasing.md). Plain cargo builds (below) never sign — they're
  # for local dev/test runs only.
  BUNDLE_ARGS=()
  if [ "$NO_BUNDLE" = true ]; then BUNDLE_ARGS+=(--no-bundle); fi
  if [ "$NO_UPDATER" = true ]; then
    # The updater key is a GitLab CI secret. GitHub mirror builds remain
    # unsigned; disabling this keeps Tauri from requiring that key.
    BUNDLE_ARGS+=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
  fi
  if [ "$VERBOSE" = true ]; then BUNDLE_ARGS+=(--verbose); fi
  # Pin the CLI major and answer the install prompt: on a CI runner npx has no
  # TTY to confirm with, and unpinned it can fetch a future major.
  npx --yes @tauri-apps/cli@2 build "${BUNDLE_ARGS[@]}"
else
  cargo build --release --manifest-path src-tauri/Cargo.toml
fi

# Sync the frontend that the running app serves. The backend reads
# FRONTEND_DIST from target/release/resources (stamped by tauri-build at
# compile time); ALSO refresh src-tauri/resources so the next compile starts
# current. Both copies come straight from frontend/dist-tauri — the actual
# build output — never from an intermediate copy (stale-bundle trap).
for TARGET_RES in "src-tauri/target/release/resources/frontend-dist" "src-tauri/resources/frontend-dist"; do
  if [ -d "$TARGET_RES" ]; then
    cp -f frontend/dist-tauri/index.html "$TARGET_RES/index.html"
    cp -rf frontend/dist-tauri/assets/. "$TARGET_RES/assets/"
    echo "[sync] frontend/dist-tauri → $TARGET_RES"
  fi
done

echo
echo "Done. Binary: src-tauri/target/release/ai-conv"
echo "Run:    ./src-tauri/target/release/ai-conv"
