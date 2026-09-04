import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const backendURL = process.env.PLAYWRIGHT_BACKEND_URL || 'http://127.0.0.1:3001';
const frontendURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const databasePath = process.env.DATABASE_PATH || path.join(os.tmpdir(), `ai-conv-playwright-${process.pid}.db`);
const jwtSecret = process.env.JWT_SECRET || 'playwright-local-only-secret';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: frontendURL,
    storageState: 'tests/.auth/user.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build --workspace=packages/types && npm run build --workspace=frontend && npm run dev --workspace=backend',
      cwd: path.resolve(__dirname, '..'),
      url: `${backendURL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_PATH: databasePath,
        JWT_SECRET: jwtSecret,
        CORS_ORIGIN: frontendURL,
        PORT: '3001',
        // CI runs Ollama in a container published to localhost; locally the
        // backend's own default (http://localhost:11434) applies. Pass it
        // through so both environments use the same single source of truth.
        OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://localhost:11434',
      },
    },
    {
      command: 'npm run build --workspace=packages/types && npm run dev --workspace=frontend -- --host 127.0.0.1',
      cwd: path.resolve(__dirname, '..'),
      url: frontendURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_WS_URL: backendURL,
        VITE_API_URL: backendURL,
        BACKEND_PROXY_TARGET: backendURL,
      },
    },
  ],
});
