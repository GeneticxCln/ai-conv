import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Single source of truth for the version shown by the browser fallback in
// Settings → About. The Tauri runtime reads the real app version instead.
const APP_VERSION = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

// ── Proxy target ───────────────────────────────────────────────────
// In Docker Compose the backend runs as `backend`; on a developer's
// machine it runs as `localhost`.  Auto-detect via env or fall back.
const BACKEND_TARGET =
  process.env.BACKEND_PROXY_TARGET ||
  process.env.VITE_BACKEND_URL ||
  'http://localhost:3001';

export default defineConfig(() => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    // outDir is env-driven. The packaged Electron app lives inside
    // frontend/dist (electron-builder output), so every other consumer must
    // emit elsewhere: E2E → dist-e2e, Tauri → dist-tauri (tauri.conf.json
    // frontendDist). `vite build` can then never empty dist/ and delete the
    // packaged app.
    outDir: process.env.VITE_OUT_DIR || 'dist',
    emptyOutDir: true,
  },
  // Relative asset URLs so the packaged Electron app can load dist/ via file://
  // (absolute /assets paths break under the file protocol).
  base: './',
  resolve: {
    alias: {
      // import.meta.url avoids __dirname, which native ESM config loading
      // no longer provides (Vite's future default).
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Health endpoint
      '/health': {
        target: BACKEND_TARGET,
        changeOrigin: true,
      },
      // Socket.io (WebSocket upgrade + polling)
      '/socket.io': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));