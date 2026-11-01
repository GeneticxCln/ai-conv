#!/usr/bin/env node

/**
 * check-version-sync.mjs
 *
 * Three places carry the desktop app version and they MUST agree:
 *   - package.json                (root; `npm version` bumps this)
 *   - src-tauri/tauri.conf.json   (what the built app reports to the updater)
 *   - the git tag `vX.Y.Z`        (what latest.json advertises)
 *
 * If tauri.conf.json lags the tag, the app reports the old version forever and
 * re-downloads the same update on every launch. If the tag lags the config,
 * latest.json advertises a version nobody can install. CI fails instead.
 *
 * Usage:
 *   node scripts/check-version-sync.mjs            # local / lint job
 *   CI_COMMIT_TAG=v0.2.0 node scripts/...         # release job
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readVersion(relativePath, pick = (json) => json.version) {
  try {
    return pick(JSON.parse(readFileSync(join(root, relativePath), 'utf8')));
  } catch (error) {
    console.error(`Cannot read version from ${relativePath}: ${error.message}`);
    process.exit(1);
  }
}

const pkgVersion = readVersion('package.json');
const tauriVersion = readVersion('src-tauri/tauri.conf.json');

if (pkgVersion !== tauriVersion) {
  console.error(
    `Version mismatch: package.json is "${pkgVersion}" but ` +
    `src-tauri/tauri.conf.json is "${tauriVersion}".\n` +
    'Bump both (docs/releasing.md) so the built app and the updater manifest agree.',
  );
  process.exit(1);
}

const tag = process.env.CI_COMMIT_TAG;
if (tag) {
  const tagVersion = tag.replace(/^v/, '');
  if (tagVersion !== pkgVersion) {
    console.error(
      `Tag "${tag}" does not match package.json version "${pkgVersion}".\n` +
      'The release would advertise a version that differs from the built app.',
    );
    process.exit(1);
  }
}

console.log(
  `Version ${pkgVersion} matches src-tauri/tauri.conf.json` +
  (tag ? ` and tag ${tag}` : ''),
);
