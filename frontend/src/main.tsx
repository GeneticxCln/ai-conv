import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installTauriBridge } from './lib/tauriAdapter';
import './index.css';

// Tauri desktop shell: install the window.electronAPI adapter BEFORE React
// mounts, so useSocketConnection's isBridgeAvailable() sees it on first run
// and takes the same code path as the Electron bridge.
installTauriBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
