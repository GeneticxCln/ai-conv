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
    },
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
