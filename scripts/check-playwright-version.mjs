#!/usr/bin/env node

/**
 * check-playwright-version.mjs
 *
 * The GitLab E2E job runs in mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy,
 * which ships the browser builds that @playwright/test expects. A mismatch
 * fails at runtime with "Executable doesn't exist".
 *
 * package.json cannot interpolate a CI variable, so PLAYWRIGHT_VERSION (defined
 * once in .gitlab-ci.yml) is the single source of truth and this check enforces
 * that frontend/package.json pins exactly that version.
 *
 * Usage:
 *   PLAYWRIGHT_VERSION=1.62.1 node scripts/check-playwright-version.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expected = process.env.PLAYWRIGHT_VERSION;

if (!expected) {
  console.error('PLAYWRIGHT_VERSION is not set; cannot verify the Playwright pin.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'frontend', 'package.json'), 'utf8'));
const actual = pkg.devDependencies?.['@playwright/test'];

if (actual !== expected) {
  console.error(
    `Playwright version mismatch: frontend/package.json pins "${actual}", ` +
    `but PLAYWRIGHT_VERSION is "${expected}".\n` +
    'Update frontend/package.json (exact version, no range) and package-lock.json, ' +
    'or bump PLAYWRIGHT_VERSION in .gitlab-ci.yml — they must match.',
  );
  process.exit(1);
}

console.log(`Playwright ${actual} matches PLAYWRIGHT_VERSION`);
