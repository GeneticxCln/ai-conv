#!/usr/bin/env node
/**
 * AI Conv backend sidecar launcher.
 *
 * Packaged with @yao-pkg/pkg into a self-contained binary that embeds the
 * Node runtime. The backend itself (ESM dist + native better-sqlite3) is NOT
 * bundled into the binary — it ships as Tauri resources next to it and is
 * started as a child process at runtime. This is the architecture the official
 * Tauri docs describe for Node sidecars ("embed the Node runtime, ship bundled
 * JS as a resource") and it keeps the backend build 100% untouched: no esm
 * bundling, no native-module snapshotting, no ABI surprises.
 *
 * Layout next to the binary (Tauri resources/):
 *   backend/dist/index.js          — compiled backend entry
 *   backend/dist/**                — full compiled tree incl. *.sql migrations
 *   backend/node_modules/**        — runtime deps incl. better-sqlite3 native binding
 *
 * Env/args: the Rust shell sets PORT, DATABASE_PATH, JWT_SECRET, OLLAMA_HOST,
 * CORS_ORIGIN. `--print-layout` (dev/debug) prints resolved paths and exits.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function resolveLayout() {
  // In a pkg snapshot, __dirname points inside the virtual FS (/snapshot/...);
  // the REAL binary's directory is dirname(process.execPath) — pkg points
  // execPath at the packaged binary itself.
  const binDir = require('path').dirname(process.execPath);
  const candidates = [
    require('path').join(binDir, 'backend'),
    require('path').join(binDir, 'resources', 'backend'),
    require('path').join(binDir, '..', 'resources', 'backend'),
    // Dev fallback: run from the repo layout
    require('path').join(binDir, '..', 'resources', 'backend'),
  ];
  for (const c of candidates) {
    const indexJs = require('path').join(c, 'dist', 'index.js');
    if (fs.existsSync(indexJs)) {
      return { backendDir: c, indexJs };
    }
  }
  return null;
}

function main() {
  const layout = resolveLayout();
  if (!layout) {
    console.error('[sidecar] FATAL: backend resources not found next to binary');
    console.error('[sidecar] execPath:', process.execPath);
    console.error('[sidecar] cwd:', process.cwd());
    process.exit(1);
  }

  if (process.argv.includes('--print-layout')) {
    console.log(JSON.stringify({ ...layout, cwd: process.cwd(), execPath: process.execPath }, null, 2));
    process.exit(0);
  }

  // Native modules (better-sqlite3) resolve through the real filesystem, so
  // the child runs with plain node semantics from the resources dir.
  const child = spawn(process.execPath, [layout.indexJs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Tell pkg's bootstrap to act as plain Node for this child. Without it,
      // re-running the packaged binary ignores the script argument and
      // re-enters launcher.cjs (the same mechanism pkg itself uses when it
      // re-invokes Node for bytecode fabrication).
      PKG_EXECPATH: 'PKG_INVOKE_NODEJS',
      NODE_PATH: path.join(layout.backendDir, 'node_modules'),
    },
  });

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGTERM', () => { forward('SIGTERM'); process.exit(0); });
  process.on('SIGINT', () => { forward('SIGINT'); process.exit(0); });

  child.on('exit', (code, signal) => {
    // Propagate the backend's exit status to the Rust supervisor.
    process.exitCode = code ?? (signal ? 1 : 0);
    process.exit(process.exitCode);
  });

  // pkg binaries keep the event loop alive for the child; nothing else needed.
}

main();
