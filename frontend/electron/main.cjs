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

  // Keep the app window on the app origin.
  const ALLOWED = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/;
  win.webContents.on('will-navigate', (event, url) => {
    if (!ALLOWED.test(url)) {
      event.preventDefault();
      if (/^https?:/.test(url)) require('electron').shell.openExternal(url);
    }
  });

  // Content-Security-Policy for the packaged app (dev server sets its own headers).
  win.webContents.on('headers-received', (event, details) => {
    if (!app.isPackaged || !details.responseHeaders) return;
    details.responseHeaders['Content-Security-Policy'] = [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:3001 http://localhost:3002 ws://localhost:3001 ws://localhost:3002",
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
