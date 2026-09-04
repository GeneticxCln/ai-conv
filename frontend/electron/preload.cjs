const { contextBridge, ipcRenderer } = require('electron');

/**
 * Read the fresh session token from the renderer's localStorage.
 * Returns null when no token exists (first launch before profile creation).
 */
function getToken() {
  try { return localStorage.getItem('aiconv_token'); } catch { return null; }
}

// Expose a safe, minimal API to the renderer.
// The renderer talks to the local backend ONLY through this bridge — it never
// opens a raw network socket.  Every invoke carries a session token so the
// main process can verify the request came from an authenticated renderer
// before relaying to the secure backend Node process.
contextBridge.exposeInMainWorld('electronAPI', {
  // ---- Secure messaging bridge ----

  /**
   * Send a user message to the backend.
   * payload.token is injected automatically — the caller should NOT add it.
   */
  sendMessage: (payload) => ipcRenderer.invoke('bridge:send-message', { ...payload, token: getToken() }),

  /**
   * Run a chat/backend command and await its ack (e.g. models:list).
   * token is injected automatically — the caller should NOT add it.
   */
  emit: (cmd, payload) => ipcRenderer.invoke('bridge:emit', { cmd, payload, token: getToken() }),

  /**
   * Subscribe to a bridge event from the backend (streamed token responses,
   * conversation/persona updates, etc.). Returns an unsubscribe function.
   */
  on: (event, callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('bridge:' + event, listener);
    return () => ipcRenderer.removeListener('bridge:' + event, listener);
  },

  /**
   * Reconfigure the bridge to connect to a different backend host or with a
   * fresh auth token.  Supports remote backends while still streaming agent
   * tokens over the secure IPC bridge (the renderer never touches the network).
   *
   * @param {string} url  - Backend Socket.IO URL (e.g. "http://remote:3001")
   * @param {string} [token] - Optional session token for authentication
   */
  configureBackend: (url, token) => ipcRenderer.invoke('bridge:configure-backend', { url, token }),

  /** Query whether the bridge is currently connected to the backend. */
  getBridgeStatus: () => ipcRenderer.invoke('bridge:status'),

  // ---- Auto-update events ----
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_e, progress) => cb(progress)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, error) => cb(error)),
  onUpdateChecking: (cb) => ipcRenderer.on('update-checking', () => cb()),

  // ---- Actions ----
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate:   () => ipcRenderer.invoke('install-update'),
  quitAndInstall:  () => ipcRenderer.invoke('quit-and-install'),

  // App info
  getVersion: () => ipcRenderer.invoke('get-app-version'),
});
