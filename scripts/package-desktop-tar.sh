#!/usr/bin/env bash
# Build the portable Linux archive from an already-built Tauri release.
# Layout matches src-tauri/target/release so the Rust shell can find the
# sidecar and resources next to the executable.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
NAME="AI-Conv-${VERSION}-linux-x86_64"
RELEASE_DIR="src-tauri/target/release"
OUT_DIR="$RELEASE_DIR/bundle"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

BIN="$RELEASE_DIR/ai-conv"
[ -f "$BIN" ] || { echo "missing $BIN — run the Tauri build first" >&2; exit 1; }

SIDECAR="$RELEASE_DIR/ai-conv-backend"
if [ ! -f "$SIDECAR" ]; then
  SIDECAR=$(find src-tauri/binaries -maxdepth 1 -name 'ai-conv-backend-*' | head -1)
fi
[ -n "$SIDECAR" ] && [ -f "$SIDECAR" ] || { echo "missing sidecar binary" >&2; exit 1; }

RESOURCES="$RELEASE_DIR/resources"
if [ ! -d "$RESOURCES" ]; then
  # `tauri build` stages resources under src-tauri/resources on CI; the
  # target/release copy only exists after a plain cargo build.
  RESOURCES="src-tauri/resources"
  echo "using staged resources at $RESOURCES"
fi
[ -d "$RESOURCES" ] || { echo "missing staged resources — run the Tauri build first" >&2; exit 1; }
for part in backend frontend-dist; do
  [ -d "$RESOURCES/$part" ] || { echo "missing $RESOURCES/$part" >&2; exit 1; }
done

mkdir -p "$STAGE/$NAME" "$OUT_DIR"
cp "$BIN" "$STAGE/$NAME/ai-conv"
cp "$SIDECAR" "$STAGE/$NAME/ai-conv-backend"
cp -R "$RESOURCES" "$STAGE/$NAME/resources"
cp README.md "$STAGE/$NAME/" 2>/dev/null || true

tar -C "$STAGE" -czf "$OUT_DIR/$NAME.tar.gz" "$NAME"
tar -tzf "$OUT_DIR/$NAME.tar.gz" >/dev/null
echo "portable archive: $OUT_DIR/$NAME.tar.gz"
