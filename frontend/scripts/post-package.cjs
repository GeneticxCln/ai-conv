#!/usr/bin/env node
/**
 * Post-build script: copies backend node_modules into the electron-builder output.
 * electron-builder excludes node_modules from extraResources by default,
 * so we have to copy them manually after the build.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FRONTEND_DIR = path.join(ROOT, '..');
const SRC = path.join(FRONTEND_DIR, 'resources', 'backend', 'node_modules');
const DEST_LINUX = path.join(FRONTEND_DIR, 'dist', 'linux-unpacked', 'resources', 'backend', 'node_modules');
const DEST_UNPACKED = path.join(FRONTEND_DIR, 'dist', 'unpacked', 'resources', 'backend', 'node_modules');

function copy(src, dest) {
  if (!fs.existsSync(src)) {
    console.log('Source not found:', src);
    return;
  }
  // Clean the destination node_modules first to avoid stale symlinks
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  try {
    fs.cpSync(src, dest, {
      recursive: true,
      dereference: false,
      filter: (srcPath) => !srcPath.includes('.cache'),
    });
  } catch (err) {
    if (err.code === 'ERR_FS_CP_EINVAL') {
      // Symlink self-reference — skip and continue
      console.log('Skipped symlinked directory');
    } else {
      throw err;
    }
  }
  console.log('Copied node_modules to', dest);
}

copy(SRC, DEST_LINUX);
copy(SRC, DEST_UNPACKED);
