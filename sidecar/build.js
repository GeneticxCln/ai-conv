#!/usr/bin/env node
/**
 * Build the AI Conv backend sidecar for the Tauri shell.
 *
 * Steps:
 *  1. (Optional) Rebuild the backend bundle into src-tauri/resources/backend
 *     by reusing frontend/scripts/bundle-backend.cjs output (it already copies
 *     backend/dist + runtime node_modules into a self-contained folder).
 *  2. Package sidecar/launcher.cjs with @yao-pkg/pkg → self-contained binary
 *     embedding the Node 20 runtime.
 *  3. Rename to the Tauri sidecar naming convention:
 *       src-tauri/binaries/ai-conv-backend-<target-triple>
 *     and copy the backend resources into src-tauri/resources/backend so the
 *     Rust shell can find both at runtime.
 *
 * Usage:
 *   node build.js              # uses already-built backend resources (fast)
 *   node build.js --rebundle   # first re-run bundle-backend.cjs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TAURI = path.join(ROOT, 'src-tauri');
const BINARIES = path.join(TAURI, 'binaries');
const RESOURCES = path.join(TAURI, 'resources');
const FRONTEND_BUNDLE = path.join(ROOT, 'frontend', 'resources', 'backend');

function hostTriple() {
  // Rust >= 1.84
  try {
    const t = execSync('rustc --print host-tuple', { encoding: 'utf-8' }).trim();
    if (t) return t;
  } catch { /* fall through */ }
  const info = execSync('rustc -vV', { encoding: 'utf-8' });
  return /host: (\S+)/.exec(info)[1];
}

function main() {
  const rebundle = process.argv.includes('--rebundle');

  // 1. Backend resources
  if (rebundle) {
    console.log('[sidecar] rebuilding backend bundle via bundle-backend.cjs...');
    execSync('node scripts/bundle-backend.cjs', {
      cwd: path.join(ROOT, 'frontend'),
      stdio: 'inherit',
    });
  }
  if (!fs.existsSync(FRONTEND_BUNDLE)) {
    console.error('[sidecar] backend bundle missing at', FRONTEND_BUNDLE);
    console.error('[sidecar] run: node build.js --rebundle  (or npm run build --workspace=backend first)');
    process.exit(1);
  }

  // 2. pkg the launcher (bytecode default: --no-bytecode breaks final
  // executables on some pkg versions; the launcher is trivial either way)
  console.log('[sidecar] packaging launcher with @yao-pkg/pkg...');
  execSync('npx @yao-pkg/pkg launcher.cjs --compress GZip --output build/ai-conv-backend', {
    cwd: __dirname,
    stdio: 'inherit',
  });

  const triple = hostTriple();
  const ext = process.platform === 'win32' ? '.exe' : '';
  const built = path.join(__dirname, 'build', `ai-conv-backend-${process.platform}-${process.arch}${ext}`);
  const fallbackBuilt = path.join(__dirname, 'build', 'ai-conv-backend');
  const source = fs.existsSync(built) ? built : fallbackBuilt;
  if (!fs.existsSync(source)) {
    console.error('[sidecar] pkg output not found (looked for', built, 'and', fallbackBuilt + ')');
    process.exit(1);
  }

  // 3. Place sidecar binary + resources where Tauri expects them
  fs.mkdirSync(BINARIES, { recursive: true });
  const target = path.join(BINARIES, `ai-conv-backend-${triple}${ext}`);
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  console.log('[sidecar] binary →', target);

  fs.mkdirSync(RESOURCES, { recursive: true });
  const resTarget = path.join(RESOURCES, 'backend');
  if (fs.existsSync(resTarget)) fs.rmSync(resTarget, { recursive: true, force: true });
  fs.cpSync(FRONTEND_BUNDLE, resTarget, { recursive: true });
  console.log('[sidecar] resources →', resTarget);

  // Frontend for the backend's single-port static serving — the Tauri
  // webview loads exactly this (same-origin, no CORS). Prefer dist-tauri
  // (built by build-tauri.sh); fall back to the Electron dist.
  const feDistTauri = path.join(ROOT, 'frontend', 'dist-tauri');
  const feDist = fs.existsSync(feDistTauri)
    ? feDistTauri
    : path.join(ROOT, 'frontend', 'dist');
  const feTarget = path.join(RESOURCES, 'frontend-dist');
  if (fs.existsSync(feDist)) {
    if (fs.existsSync(feTarget)) fs.rmSync(feTarget, { recursive: true, force: true });
    fs.cpSync(feDist, feTarget, {
      recursive: true,
      filter: (src) => !src.includes('linux-unpacked') && !src.includes('dist-e2e'),
    });
    console.log('[sidecar] frontend →', feTarget);
  }

  console.log('[sidecar] done.');
}

main();
