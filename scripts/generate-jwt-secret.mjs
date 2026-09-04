#!/usr/bin/env node

/**
 * generate-jwt-secret.mjs
 *
 * Idempotent setup script: generates a cryptographically random JWT_SECRET
 * and writes it to the project-root .env file if one is not already present.
 * Safe to run multiple times — never overwrites an existing secret.
 *
 * Usage:
 *   node scripts/generate-jwt-secret.mjs
 *
 * Called automatically by `npm run setup`.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_PATH = join(ROOT, '.env');
const ENV_EXAMPLE_PATH = join(ROOT, '.env.example');

function generateSecret() {
  return randomBytes(32).toString('hex');
}

function ensureEnvFile() {
  // Create .env from .env.example if it doesn't exist
  if (!existsSync(ENV_PATH)) {
    if (existsSync(ENV_EXAMPLE_PATH)) {
      const example = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
      // Strip the [TEMPLATE] header line if present
      const cleaned = example.replace(/^\[TEMPLATE\]\n?/m, '');
      writeFileSync(ENV_PATH, cleaned, 'utf8');
      console.log('📄 Created .env from .env.example');
    } else {
      writeFileSync(ENV_PATH, '', 'utf8');
      console.log('📄 Created empty .env');
    }
  }
}

function hasJwtSecret() {
  const content = readFileSync(ENV_PATH, 'utf8');
  // Match JWT_SECRET=... where the value is not a placeholder
  const match = content.match(/^JWT_SECRET=(.+)$/m);
  if (!match) return false;
  const value = match[1].trim();
  // Consider placeholder values as "not set"
  if (!value || value === 'your-secret-key-change-in-production' || value === 'changeme') {
    return false;
  }
  return true;
}

function addJwtSecret() {
  const secret = generateSecret();
  const content = readFileSync(ENV_PATH, 'utf8');

  // Replace placeholder if present, otherwise append
  if (/^JWT_SECRET=(your-secret-key-change-in-production|changeme)\s*$/m.test(content)) {
    const updated = content.replace(
      /^JWT_SECRET=(?:your-secret-key-change-in-production|changeme)\s*$/m,
      `JWT_SECRET=${secret}`
    );
    writeFileSync(ENV_PATH, updated, 'utf8');
  } else {
    // Append with newline
    const separator = content.endsWith('\n') ? '' : '\n';
    appendFileSync(ENV_PATH, `${separator}JWT_SECRET=${secret}\n`, 'utf8');
  }

  console.log(`🔑 Generated JWT_SECRET and saved to .env`);
}

// ── Main ──────────────────────────────────────────────────────────
ensureEnvFile();

if (hasJwtSecret()) {
  console.log('✅ JWT_SECRET already set in .env — skipping');
} else {
  addJwtSecret();
}
