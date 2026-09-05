import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// ── Proxy target ───────────────────────────────────────────────────
// In Docker Compose the backend runs as `backend`; on a developer's
// machine it runs as `localhost`.  Auto-detect via env or fall back.
const BACKEND_TARGET =
  process.env.BACKEND_PROXY_TARGET ||
  process.env.VITE_BACKEND_URL ||
  'http://localhost:3001';

export default defineConfig(({ command }) => ({
  // Strip console.* from production bundles (`vite build`); keep them in dev.
  esbuild: {
    drop: command === 'build' ? ['console'] : [],
  },
  plugins: [react()],
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
      '@': path.resolve(__dirname, './src'),
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