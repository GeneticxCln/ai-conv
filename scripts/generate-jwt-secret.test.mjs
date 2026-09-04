import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(import.meta.dirname, 'generate-jwt-secret.mjs');

/** Create a temporary directory with isolated .env files for each test. */
function makeTmpDir() {
  const dir = join(import.meta.dirname, `.test-tmp-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('generate-jwt-secret.mjs', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .env with a valid JWT_SECRET when none exists', () => {
    const envPath = join(tmpDir, '.env');
    execFileSync('node', [SCRIPT], { cwd: tmpDir, env: { ...process.env } });

    expect(existsSync(envPath)).toBe(true);
    const content = readFileSync(envPath, 'utf8');
    const match = content.match(/^JWT_SECRET=([a-f0-9]{64})$/m);
    expect(match).not.toBeNull();
    // Should be a 64-char hex string (32 bytes)
    expect(match[1]).toHaveLength(64);
  });

  it('does not overwrite an existing JWT_SECRET', () => {
    const envPath = join(tmpDir, '.env');
    const existingSecret = 'my-existing-secret-12345';
    writeFileSync(envPath, `JWT_SECRET=${existingSecret}\n`, 'utf8');

    execFileSync('node', [SCRIPT], { cwd: tmpDir, env: { ...process.env } });

    const content = readFileSync(envPath, 'utf8');
    expect(content).toContain(`JWT_SECRET=${existingSecret}`);
    // Should not have a second JWT_SECRET line
    const matches = content.match(/^JWT_SECRET=/gm);
    expect(matches).toHaveLength(1);
  });

  it('replaces a placeholder JWT_SECRET value', () => {
    const envPath = join(tmpDir, '.env');
    writeFileSync(envPath, 'JWT_SECRET=your-secret-key-change-in-production\n', 'utf8');

    execFileSync('node', [SCRIPT], { cwd: tmpDir, env: { ...process.env } });

    const content = readFileSync(envPath, 'utf8');
    expect(content).not.toContain('your-secret-key-change-in-production');
    const match = content.match(/^JWT_SECRET=([a-f0-9]{64})$/m);
    expect(match).not.toBeNull();
  });

  it('creates .env from .env.example when .env is missing', () => {
    const examplePath = join(tmpDir, '.env.example');
    writeFileSync(examplePath, '[TEMPLATE]\nPORT=3001\nJWT_SECRET=your-secret-key-change-in-production\n', 'utf8');

    execFileSync('node', [SCRIPT], { cwd: tmpDir, env: { ...process.env } });

    const envPath = join(tmpDir, '.env');
    const content = readFileSync(envPath, 'utf8');
    expect(content).toContain('PORT=3001');
    expect(content).not.toContain('[TEMPLATE]');
    // The placeholder should be replaced with a real secret
    const match = content.match(/^JWT_SECRET=([a-f0-9]{64})$/m);
    expect(match).not.toBeNull();
  });

  it('is idempotent — running twice produces the same secret', () => {
    execFileSync('node', [SCRIPT], { cwd: tmpDir, env: { ...process.env } });
    const firstContent = readFileSync(join(tmpDir, '.env'), 'utf8');

    execFileSync('node', [SCRIPT], { cwd: tmpDir, env: { ...process.env } });
    const secondContent = readFileSync(join(tmpDir, '.env'), 'utf8');

    expect(firstContent).toBe(secondContent);
  });
});
