const { app, BrowserWindow } = require('electron');
const path = require('path');

function getStartUrl() {
  // Packaged app: serve the bundled build from dist/
  if (app.isPackaged) {
    return 'file://' + path.join(__dirname, '..', 'dist', 'index.html');
  }
  // Dev: Vite dev server (Docker or local)
  return process.env.APP_URL || 'http://localhost:5173';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'AI Conv',
    autoHideMenuBar: true,
    backgroundColor: '#f9fafb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the OS browser; never spawn Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Keep the app window on the app origin. Extra origins come from APP_URL /
  // AI_CONV_EXTRA_ORIGINS (comma-separated) so non-local deployments work.
  const appOrigin = (() => {
    try { return new URL(getStartUrl()).origin; } catch { return null; }
  })();
  const extraOrigins = (process.env.AI_CONV_EXTRA_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', appOrigin, ...extraOrigins]
    .filter(Boolean);
  const ALLOWED = new RegExp('^https?:\\/\\/(' + allowedOrigins.map(o => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');

  win.webContents.on('will-navigate', (event, url) => {
    if (!ALLOWED.test(url)) {
      event.preventDefault();
      if (/^https?:/.test(url)) require('electron').shell.openExternal(url);
    }
  });

  // Content-Security-Policy for the packaged app; connect-src follows the
  // backend origins the window is allowed to reach.
  const apiOrigins = [
    'http://localhost:3001', 'http://localhost:3002',
    'ws://localhost:3001', 'ws://localhost:3002',
    ...(process.env.AI_CONV_API_ORIGIN ? [process.env.AI_CONV_API_ORIGIN, process.env.AI_CONV_API_ORIGIN.replace(/^http/, 'ws')] : []),
  ];
  win.webContents.on('headers-received', (event, details) => {
    if (!app.isPackaged || !details.responseHeaders) return;
    details.responseHeaders['Content-Security-Policy'] = [
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${apiOrigins.join(' ')}`,
    ];
    event.headers = details.responseHeaders;
  });

  win.loadURL(getStartUrl());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
