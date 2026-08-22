import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
  // Strip console.* from production bundles (`vite build`); keep them in dev.
  esbuild: {
    drop: command === 'build' ? ['console'] : [],
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/health': {
        target: 'http://backend:3001',
        changeOrigin: true,
      },
    },
  },
}));
