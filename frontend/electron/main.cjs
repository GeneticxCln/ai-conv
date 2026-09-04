const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

// Socket.io client used by the MAIN process to talk to the local backend.
// The renderer NEVER talks to the network socket directly — it goes through
// the secure Electron IPC bridge and the main process relays to the backend.
let { io: createSocket } = require('socket.io-client');

const isPackaged = app.isPackaged;

// =====================================================================
// Session-token verifier — every IPC bridge invoke must carry a fresh
// JWT so the renderer cannot ask the main process to relay unauthenticated
// requests.  Uses the same HMAC-SHA256 secret the backend was launched with.
// =====================================================================
// JWT secret: use env var if set, otherwise derive a persistent secret
// from the same location as the backend (next to the database) so they
// always share the same secret when running in packaged or dev mode.
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Try reading from .env in the project directory
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const match = envContent.match(/^JWT_SECRET=(.+)$/m);
      if (match) return match[1].trim();
    }
  } catch { /* ignore */ }
  // Persistent random secret stored next to the database (same as backend).
  // Check all candidate locations across dev, docker, and electron environments.
  const candidateDirs = [
    process.env.DATABASE_PATH ? path.dirname(path.resolve(process.env.DATABASE_PATH)) : null,
    isPackaged ? path.join(app.getPath('userData'), 'data') : null,
    path.join(__dirname, '..', '..', 'data'),
    path.join(__dirname, '..', '..', 'backend', 'data'),
  ].filter(Boolean);

  for (const dir of candidateDirs) {
    const candidatePath = path.join(dir, '.jwt-secret');
    if (fs.existsSync(candidatePath)) {
      try { return fs.readFileSync(candidatePath, 'utf-8').trim(); } catch {}
    }
  }

  const primaryDir = candidateDirs[0] || path.join(__dirname, '..', '..', 'data');
  const secretPath = path.join(primaryDir, '.jwt-secret');
  try {
    const secret = crypto.randomBytes(32).toString('hex');
    if (!fs.existsSync(primaryDir)) fs.mkdirSync(primaryDir, { recursive: true });
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  } catch {
    // Last resort: ephemeral secret (tokens invalid on restart, but safe)
    return crypto.randomBytes(32).toString('hex');
  }
}
const JWT_SECRET = loadJwtSecret();
const JWT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // Keep in sync with backend auth.ts

/**
 * Verify a base64url JWT string. Returns { sub, iat } on success,
 * or throws on any failure.  Uses only Node's built-in crypto — no
 * new runtime dependency needed.
 */
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) throw new Error('malformed');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Verify the signature in constant time.
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(headerB64 + '.' + payloadB64)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signatureB64), Buffer.from(expectedSig))) {
    throw new Error('bad signature');
  }

  // 2. Decode payload (backend uses 'userId', standard JWT uses 'sub' — accept both).
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  const userId = payload.sub || payload.userId;
  if (!payload.iat || !userId) throw new Error('missing claims');
  if (payload.exp && Date.now() >= payload.exp * 1000) throw new Error('token expired');

  // 3. Reject tokens older than JWT_MAX_AGE.
  const age = Date.now() - payload.iat * 1000;
  if (age > JWT_MAX_AGE || age < -5000) throw new Error('token expired or future');

  return { sub: userId, iat: payload.iat };
}

// =====================================================================
// Rendering stability setup — MUST run before app.whenReady() resolves.
// Forces Chromium onto stable rendering pipelines and provides a
// fallback that strips hardware acceleration if the GPU subsystem
// (e.g. proprietary NVIDIA Vulkan on Wayland) chokes at runtime.
// =====================================================================
let gpuCrashed = false; // set when the GPU process dies unexpectedly

// Detect an NVIDIA dGPU present on this machine.
function hasNvidiaGpu() {
  // Fast path: NVIDIA drivers are almost always present in env when loaded.
  if (process.env.NVIDIA_DRIVER_CAPABILITIES) return true;
  try {
    const probe = execSync('lspci 2>/dev/null || true', { encoding: 'utf-8', timeout: 3000 });
    return /nvidia|geforce|rtx|quadro|tesla/i.test(probe);
  } catch {
    return false;
  }
}

// Detect a Wayland session.
function runningOnWayland() {
  return !!(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');
}

const isNvidia = hasNvidiaGpu();
const isWayland = runningOnWayland();
const stableRenderEnabled = process.env.AICONV_GPU === 'off' || isWayland;

if (stableRenderEnabled) {
  console.log('[render] Using stable (GL/software) rendering pipeline');
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-vulkan');
  // On Wayland+Electron 43 the out-of-process network service dies
  // with SIGTERM after ~8s, taking the renderer down with it.
  // Running it in-process avoids the crash entirely.
  if (isWayland) {
    app.commandLine.appendSwitch('disable-features', 'NetworkService');
  }
} else if (isNvidia && isWayland) {
  // Non-Wayland unlikely with NVIDIA, but guard anyway:
  console.log('[render] NVIDIA + compositor detected — hardening GL pipeline');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'gl');
  app.commandLine.appendSwitch('disable-vulkan');
}

// =====================================================================
// Fallback watchdog: if the GPU process ever dies, strip hardware
// acceleration and relaunch the window so the app keeps running.
// =====================================================================
app.on('child-process-gone', (event, details) => {
  // GPU died — reload the window on software rendering.
  // On Wayland + NVIDIA the compositor kills the GPU process with
  // exitCode=15 (SIGTERM, reason 'killed'). We must handle that too.
  if (details.type === 'GPU' && !gpuCrashed) {
    console.error('[render] GPU died (' + details.reason + ':' + details.exitCode + ') — reloading on software');
    gpuCrashed = true;
    app.disableHardwareAcceleration();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  }
  // Renderer also died — if the window still exists, reload it.
  if (details.type === 'Renderer' && !gpuCrashed) {
    console.error('[render] Renderer died (' + details.reason + ':' + details.exitCode + ') — reloading');
    gpuCrashed = true;
    app.disableHardwareAcceleration();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  }
});

// In packaged builds electron-builder places frontend files under the app's
// resources/app.asar; in development they are next to electron/. Resolve
// explicitly so the backend never tries to serve a nonexistent frontend path.
const DIST_DIR = isPackaged
  ? path.join(__dirname, '..', 'dist')
  : path.join(__dirname, '..', 'dist');
const BACKEND_DIR = isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : path.join(__dirname, '..', '..', 'backend');

let backendProcess = null;
let frontendServer = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;

function getTrayIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (img.getSize().width !== 16) return img.resize({ width: 16, height: 16 });
    return img;
  }
  return nativeImage.createEmpty();
}

// ============ Auto-updater (only in packaged builds) ============
let autoUpdater = null;
if (isPackaged) {
  try {
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      sendToUpdateWindow('update-checking');
    });

    autoUpdater.on('update-available', (info) => {
      sendToUpdateWindow('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
      autoUpdater.downloadUpdate().catch(() => {});
    });

    autoUpdater.on('download-progress', (progress) => {
      sendToUpdateWindow('update-download-progress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      sendToUpdateWindow('update-downloaded', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('error', () => {}); // Silently ignore

    ipcMain.handle('check-for-updates', async () => {
      if (!autoUpdater) return;
      try { return await autoUpdater.checkForUpdates(); } catch {}
    });
    ipcMain.handle('install-update', () => { if (autoUpdater) autoUpdater.quitAndInstall(); });
    ipcMain.handle('quit-and-install', () => { if (autoUpdater) autoUpdater.quitAndInstall(); });
    ipcMain.handle('get-app-version', () => app.getVersion());
  } catch {}
}

function sendToUpdateWindow(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// =====================================================================
// Secure IPC bridge: the renderer sends user messages and commands over
// Electron IPC; this main-process bridge connects to the local backend
// (the secure Node process that runs the AI generation) and relays both
// directions. The renderer never opens a raw network socket itself.
// Only the current window's webContents may use the bridge.
// =====================================================================
let backendSocket = null;
let bridgeHealthInterval = null;

// Backend socket events we are willing to forward to the renderer.
const FORWARD_TO_RENDERER = new Set([
  'agent:token', 'agent:done', 'agent:error', 'message:user',
  'messages:older', 'conversation:list', 'conversation:created', 'conversation:deleted',
  'conversations:cleared', 'personas:list', 'messages:history',
  'message:deleted', 'message:created', 'generation:stopped',
  'model:pull:progress', 'users:list', 'models:list', 'user:current', 'auth:error', 'authorization:error', 'validation:error',
]);

function connectBridge(wsUrl, token) {
  // Use port 3001 — Fastify and Socket.io share the same server now.
  const url = wsUrl || process.env.VITE_WS_URL || 'http://localhost:3001';
  console.log('[ipc] Bridging renderer <-> backend at', url, token ? '(auth)' : '(no auth)');
  const auth = token ? { token } : undefined;
  // Only the initial (unauthenticated) bridge should auto-reconnect to
  // survive backend restarts.  Reconfiguration attempts with a stale token
  // must NOT retry — each failed attempt carries the same bad credentials
  // and would create an infinite loop.
  const reconnect = !token && !backendSocket;
  const newSocket = createSocket(url, {
    transports: ['websocket', 'polling'],
    reconnection: reconnect,
    reconnectionAttempts: reconnect ? 20 : 0,
    reconnectionDelay: 1000,
    auth,
  });

  let mounted = false;
  let errored = false;
  let resolveReady = () => {};
  let rejectReady = () => {};
  let readyTimer = null;
  const ready = token
    ? new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      })
    : Promise.resolve();

  // A token-bound bridge must not report success until the authenticated
  // socket has replaced the anonymous bridge. This removes the race where
  // the UI enables commands while they are still sent on an unauthenticated
  // socket.
  if (token) {
    readyTimer = setTimeout(() => {
      if (mounted || errored) return;
      errored = true;
      rejectReady(new Error('Backend authentication timed out'));
      newSocket.io.opts.reconnection = false;
      try { newSocket.disconnect(); } catch { /* ignore */ }
    }, 10000);
  }

  // Socket.io can fire 'connect' BEFORE the auth middleware runs (transport
  // upgrade happens first, then auth rejection arrives as 'connect_error').
  // We must NOT swap backendSocket until we know auth actually succeeded.
  // Defer the swap by 200 ms — if connect_error fires in that window,
  // we tear down the new socket and keep the original bridge alive.
  newSocket.on('connect', () => {
    console.log('[ipc] Bridge connected to backend:', newSocket.id);
    setTimeout(() => {
      if (errored || !newSocket.connected) {
        // Auth failed or socket died — clean up, don't touch backendSocket.
        console.log('[ipc] Bridge connect was rejected — discarding');
        newSocket.io.opts.reconnection = false;
        newSocket.removeAllListeners();
        try { newSocket.disconnect(); } catch { /* ignore */ }
        return;
      }
      // Auth confirmed — swap in the new socket.
      mounted = true;
      if (backendSocket && backendSocket !== newSocket) {
        backendSocket.removeAllListeners();
        backendSocket.disconnect();
      }
      backendSocket = newSocket;
      if (readyTimer) clearTimeout(readyTimer);
      resolveReady();
      // Periodic health log so you can see the bridge stays alive.
      clearInterval(bridgeHealthInterval);
      bridgeHealthInterval = setInterval(() => {
        if (backendSocket?.connected) {
          console.log('[ipc] Bridge healthy');
        }
      }, 30000);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bridge:connect');
      }
      newSocket.emit('personas:list');
      newSocket.emit('conversation:list');
    }, 200);
  });

  newSocket.on('disconnect', (reason) => {
    console.warn('[ipc] Bridge disconnected:', reason);
    if (mounted && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bridge:disconnect', reason);
    }
  });

  // Forward whitelisted backend events to the focused renderer window.
  for (const event of FORWARD_TO_RENDERER) {
    newSocket.on(event, (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bridge:' + event, payload);
      }
    });
  }

  newSocket.on('connect_error', (err) => {
    console.warn('[ipc] Bridge connect error:', err.message);
    errored = true;
    if (token && mainWindow && !mainWindow.isDestroyed()) {
      // Tell the renderer to discard a stale token and return to profile
      // selection instead of leaving a green but unusable bridge.
      mainWindow.webContents.send('bridge:auth-error', { error: err.message });
    }
    if (token) {
      if (readyTimer) clearTimeout(readyTimer);
      rejectReady(new Error(err.message));
    }
    // Clean up this failed attempt — the original bridge (if any)
    // is untouched because we deferred the swap in the connect handler.
    if (!mounted) {
      console.log('[ipc] Auth/connect failed, discarding attempt — original bridge intact');
      // Aggressively kill this socket — stop timers, close transport, remove listeners.
      try { newSocket.io.engine.close(); } catch { /* ignore */ }
      newSocket.io.opts.reconnection = false;
      newSocket.removeAllListeners();
      newSocket.close();
    }
  });

  // If this is the very first bridge (no existing backendSocket), set it
  // optimistically so event forwarding works as soon as connect fires.
  if (!backendSocket) backendSocket = newSocket;
  return ready;
}

// ---- Commands from renderer over IPC ----
// Validate that the call comes from our own main window before relaying.
function isTrustedSender(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return !!win && win === mainWindow;
}

ipcMain.handle('bridge:send-message', (event, payload) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender' };
  // Validate the session token attached by preload.cjs.
  if (!payload || typeof payload.token !== 'string') {
    return { ok: false, error: 'Missing session token' };
  }
  try { verifyToken(payload.token); } catch (err) {
    return { ok: false, error: 'Invalid token: ' + err.message };
  }
  if (typeof payload.content !== 'string') {
    return { ok: false, error: 'Invalid message payload' };
  }
  backendSocket.emit('user:message', payload);
  return { ok: true };
});

ipcMain.handle('bridge:emit', (event, { cmd, payload, token }) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender' };

  // Commands that do NOT require a session token — the backend handles
  // these without authentication (most management/list commands).  Only
  // user:message and destructive operations require a valid token.
  const UNAUTHENTICATED = new Set(['user:create']);

  if (!UNAUTHENTICATED.has(cmd)) {
    // Validate the session token attached by preload.cjs.
    if (typeof token !== 'string') {
      return { ok: false, error: 'Missing session token' };
    }
    try { verifyToken(token); } catch (err) {
      return { ok: false, error: 'Invalid token: ' + err.message };
    }
  }
  const allowed = new Set([
    'join', 'leave', 'session:current', 'personas:list', 'conversation:list',
    'conversation:create', 'conversation:delete', 'conversation:rename',
    'conversations:clear', 'persona:create', 'persona:update', 'persona:delete',
    'messages:older', 'users:list', 'user:create', 'user:select', 'user:delete',
    'participants:set', 'message:delete', 'message:regenerate',
    'conversation:import', 'generation:stop', 'model:pull',    'models:list', 'models:list:full', 'user:message', 'persona:toggle', 'data:import', 'data:export',
  ]);
  if (!allowed.has(cmd)) return { ok: false, error: 'Command not allowed' };
  if (!backendSocket?.connected) {
    return { ok: false, error: 'Backend bridge disconnected' };
  }
  // Commands whose backend handler expects the ack callback as first argument.
  // For these, emitWithAck must be called WITHOUT a payload so the ack
  // lands in the right position (otherwise payload steals it and times out).
  const ACK_AS_FIRST_ARG = new Set(['session:current', 'models:list', 'models:list:full', 'users:list', 'data:export']);

  // Use plain emit for fire-and-forget commands to avoid hanging ack promises.
  // Only commands where the backend handler actually calls ack() should use emitWithAck.
  const USES_ACK = new Set([
    'session:current', 'models:list', 'models:list:full', 'users:list', 'user:create', 'user:select', 'data:export',
    'data:import', 'conversation:import', 'conversation:create', 'messages:older',
    'persona:create', 'persona:update', 'persona:delete', 'persona:toggle',
    'conversation:delete', 'conversation:rename', 'conversations:clear',
    'participants:set', 'message:delete', 'message:regenerate', 'user:delete', 'generation:stop',
  ]);

  if (!USES_ACK.has(cmd)) {
    // Fire-and-forget: just emit, don't wait for ack.
    // Inject the token into auth-requiring commands so the backend
    // handler can authenticate without a pre-authenticated socket.
    const finalPayload = (!UNAUTHENTICATED.has(cmd) && token && typeof payload === 'object' && payload !== null)
      ? { ...payload, token }
      : payload;
    if (ACK_AS_FIRST_ARG.has(cmd)) {
      backendSocket.emit(cmd);
    } else {
      backendSocket.emit(cmd, finalPayload ?? null);
    }
    return { ok: true };
  }

  // Commands that actually use ack — use emitWithAck and await the response
  return new Promise((resolve) => {
    const ack = ACK_AS_FIRST_ARG.has(cmd)
      ? backendSocket.emitWithAck(cmd)
      : backendSocket.emitWithAck(cmd, payload ?? null);
    ack.then(
      (res) => resolve({ ok: true, data: res }),
      (err) => resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
    );
  });
});

// ---- Reconfigure the bridge at runtime ----
// Lets the renderer tell the main process to connect to a different backend
// host (or the same host with a fresh auth token).  Supports remote backends
// while still streaming agent tokens over the secure IPC bridge.
ipcMain.handle('bridge:configure-backend', async (event, { url, token }) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender' };
  // Skip if bridge is already connected and no token update (prevents stale-token loop)
  if (backendSocket && backendSocket.connected && !token) {
    console.log('[ipc] Bridge already connected, skipping no-token reconfigure');
    return { ok: true };
  }
  console.log('[ipc] Reconfiguring bridge — url:', url || '(default)', 'token:', token ? 'yes' : 'no');
  try {
    await connectBridge(url || undefined, token || undefined);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Backend authentication failed' };
  }
});

// ---- Query bridge connection status ----
// The bridge may connect before the renderer mounts, so the initial
// 'bridge:connect' event is lost.  When the renderer polls, we re-send
// the connect event and re-emit persona/conversation lists so the
// renderer can sync the UI immediately even after a late mount.
ipcMain.handle('bridge:status', (event) => {
  const connected = !!(backendSocket && backendSocket.connected);
  if (connected && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bridge:connect');
    // Re-request data lists — the renderer may have missed them
    backendSocket.emit('session:current');
    backendSocket.emit('personas:list');
    backendSocket.emit('conversation:list');
  }
  return { ok: true, connected };
});

// ============ Frontend static file server ============
function startFrontendServer(port) {
  return new Promise((resolve, reject) => {
    const MIME = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    };

    const server = http.createServer((req, res) => {
      let url = req.url.split('?')[0];
      let fp = path.join(DIST_DIR, url === '/' ? 'index.html' : url);
      if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        fp = path.join(DIST_DIR, 'index.html');
      }
      try {
        const content = fs.readFileSync(fp);
        const ext = path.extname(fp);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(port, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/`, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

/**
 * Poll an HTTP URL until it returns a 200 response (or we time out).
 * The window stays hidden until the server is confirmed healthy, preventing
 * the white-page flash when the renderer loads before the server is ready.
 */
function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() > deadline) {
        return reject(new Error(`Server at ${url} not ready after ${timeoutMs}ms`));
      }
      const req = http.get(url, (res) => {
        if (res.statusCode === 200 || res.statusCode === 304) {
          res.resume();
          resolve();
        } else {
          res.resume();
          setTimeout(tryConnect, 300);
        }
      });
      req.on('error', () => setTimeout(tryConnect, 300));
      req.setTimeout(2000, () => { req.destroy(); setTimeout(tryConnect, 300); });
    };
    tryConnect();
  });
}

// ============ Backend ============
async function startBackend(port) {
  if (await isPortInUse(port)) return;

  const indexJs = path.join(BACKEND_DIR, 'dist', 'index.js');
  if (!fs.existsSync(indexJs)) {
    console.error('Backend not found at', indexJs);
    return;
  }

  // Packaged builds must keep user data outside resources: electron-builder
  // replaces resources/backend on every rebuild/update. Development keeps
  // using backend/data for compatibility with the normal backend workflow.
  const legacyDataDir = path.join(BACKEND_DIR, 'data');
  const dataDir = isPackaged ? path.join(app.getPath('userData'), 'data') : legacyDataDir;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Migrate an existing unpacked-build database once, if one is present.
  const legacyDb = path.join(legacyDataDir, 'ai-conv.db');
  const targetDb = path.join(dataDir, 'ai-conv.db');
  if (isPackaged && fs.existsSync(legacyDb) && !fs.existsSync(targetDb)) {
    fs.copyFileSync(legacyDb, targetDb);
    for (const suffix of ['-wal', '-shm']) {
      const source = legacyDb + suffix;
      if (fs.existsSync(source)) fs.copyFileSync(source, targetDb + suffix);
    }
  }

  const env = {
    ...process.env,
    JWT_SECRET: process.env.JWT_SECRET || JWT_SECRET,
    DATABASE_PATH: path.join(dataDir, 'ai-conv.db'),
    OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://localhost:11434',
    FRONTEND_DIST: isPackaged ? path.join(process.resourcesPath, 'frontend-dist') : DIST_DIR,
    PORT: String(port),
    NODE_PATH: path.join(BACKEND_DIR, 'node_modules'),
  };

  let nodeBin;
  try { nodeBin = execSync('which node', { encoding: 'utf-8' }).trim(); } catch {}
  if (!nodeBin) {
    nodeBin = process.execPath;
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  backendProcess = spawn(nodeBin, [indexJs], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (d) => console.log(`[backend] ${d.toString().trim()}`));
  backendProcess.stderr.on('data', (d) => console.error(`[backend] ${d.toString().trim()}`));
  backendProcess.on('exit', (code) => { backendProcess = null; });

  // Wait for backend to be ready
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 8000);
    const check = () => {
      isPortInUse(port).then((used) => {
        if (used) { clearTimeout(timeout); resolve(); }
        else setTimeout(check, 500);
      });
    };
    check();
  });
}

// ============ Window ============
function createWindow(url) {
  const preloadPath = path.join(__dirname, 'preload.cjs');

  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'AI Conv',
    autoHideMenuBar: true,
    backgroundColor: '#1f2937',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.once('ready-to-show', async () => {
    // The window content may have loaded a blank/error page. Wait until
    // the server is confirmed healthy before showing the window.
    try {
      await waitForServer(url, 10000);
      console.log('[health] Frontend server confirmed healthy — showing window');
    } catch (err) {
      console.warn('[health] Frontend server check failed:', err.message);
      // Show anyway — better a white page than a hidden app the user
      // thinks never launched.
    }
    win.show();
    win.focus();
  });

  // Log renderer/gpu crashes so we can diagnose instead of silently dying
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[main] render-process-gone:', JSON.stringify(details));
  });
  app.on('child-process-gone', (event, details) => {
    console.error('[main] child-process-gone:', details.type, details.reason, details.exitCode);
  });

  win.loadURL(url);
  mainWindow = win;
  return win;
}

// ============ Main ============
app.whenReady().then(async () => {
  try {
    await startBackend(3001);

    // Bring up the secure IPC bridge to the local backend.
    connectBridge();

    // Packaged builds serve the frontend from the backend's single port.
    // Development keeps the standalone static server on 5173.
    const frontendPort = isPackaged ? 3001 : 5173;
    if (!isPackaged && !(await isPortInUse(frontendPort))) {
      frontendServer = await startFrontendServer(frontendPort);
    }

    const url = `http://localhost:${frontendPort}`;

    // Wait for the frontend server to be ready before loading the window.
    // The built-in static server starts fast, but on slow disks or when a
    // previous instance hasn't released the port yet, this avoids a failed
    // first load and the subsequent white screen.
    try {
      console.log('[health] Waiting for frontend server at', url);
      await waitForServer(url, 12000);
      console.log('[health] Frontend server ready');
    } catch (err) {
      console.warn('[health] Frontend server not ready, proceeding anyway:', err.message);
    }

    createWindow(url);

    // System tray
    tray = new Tray(getTrayIcon());
    tray.setToolTip('AI Conv');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show AI Conv', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });

    // Auto-update is disabled on startup — it was quitting the app on a
    // failed check (nonexistent GitHub repo). User can trigger via the preload
    // button if configured. Kept out to avoid unexpected quits.

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
  if (frontendServer) { frontendServer.close(); frontendServer = null; }
  if (tray) { tray.destroy(); tray = null; }
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
  if (frontendServer) { frontendServer.close(); frontendServer = null; }
  if (tray) { tray.destroy(); tray = null; }
});
