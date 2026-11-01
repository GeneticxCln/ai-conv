#!/usr/bin/env node

/**
 * check-version-sync.mjs
 *
 * Four places carry the desktop app version and they MUST agree:
 *   - package.json                (root; `npm version` bumps this)
 *   - src-tauri/tauri.conf.json   (what the built app reports to the updater)
 *   - src-tauri/Cargo.toml        (the crate / binary version)
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

function readCargoVersion() {
  try {
    const toml = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8');
    const match = toml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
    if (!match) throw new Error('no version under [package]');
    return match[1];
  } catch (error) {
    console.error(`Cannot read version from src-tauri/Cargo.toml: ${error.message}`);
    process.exit(1);
  }
}

const pkgVersion = readVersion('package.json');
const tauriVersion = readVersion('src-tauri/tauri.conf.json');
const cargoVersion = readCargoVersion();

if (pkgVersion !== tauriVersion || pkgVersion !== cargoVersion) {
  console.error(
    `Version mismatch: package.json is "${pkgVersion}", ` +
    `src-tauri/tauri.conf.json is "${tauriVersion}", and ` +
    `src-tauri/Cargo.toml is "${cargoVersion}".\n` +
    'Bump all three (docs/releasing.md) so the built app, its binary, and the updater manifest agree.',
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
  `Version ${pkgVersion} matches src-tauri/tauri.conf.json and src-tauri/Cargo.toml` +
  (tag ? ` and tag ${tag}` : ''),
);
