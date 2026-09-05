import { invoke } from '@tauri-apps/api/core';

/**
 * Tauri desktop adapter — drop-in for the Electron preload bridge.
 *
 * KEY DIFFERENCE FROM ELECTRON: the Tauri webview (WebKitGTK) has no CSP
 * restriction against loopback sockets, so the frontend talks to the backend
 * DIRECTLY over socket.io — no main-process relay, no command allowlist, no
 * per-invoke token verification (the backend's own loopback + JWT checks are
 * the security boundary, exactly as in browser mode).
 *
 * This adapter exists only so code that checks `window.electronAPI` (and the
 * existing bridge tests) keeps working unchanged: it exposes the same method
 * surface, backed by a real socket.io connection created lazily on first use.
 */

type Ack = { ok: boolean; data?: unknown; error?: string };

let socket: import('socket.io-client').Socket | null = null;
let connecting: Promise<import('socket.io-client').Socket> | null = null;

// Same-origin default (the Tauri window loads the app from the backend); the
// env var is a dev/browser override. (Guarded for Node test environments.)
const WS_URL: string =
  import.meta.env.VITE_WS_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');

async function getSocket(): Promise<import('socket.io-client').Socket> {
  if (socket?.connected) return socket;
  if (connecting) return connecting;
  connecting = (async () => {
    const { io } = await import('socket.io-client');
    const token = (() => {
      try { return localStorage.getItem('aiconv_token'); } catch { return null; }
    })();
    socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      auth: token ? { token } : undefined,
      reconnection: true,
    });
    return socket;
  })();
  return connecting;
}

// Backend handlers whose signature is (ack?) — the ack callback is the FIRST
// argument. Emitting any payload positionally steals the ack slot and the
// call times out. Mirror of the Electron bridge's ACK_AS_FIRST_ARG set.
const ACK_AS_FIRST_ARG = new Set([
  'session:current',
  'models:list',
  'models:list:full',
  'users:list',
  'data:export',
  'system:gpu',
  'users:list:bootstrap',
]);

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Install window.electronAPI backed by Tauri. Call once at app startup. */
export function installTauriBridge(): void {
  if (!isTauri() || typeof window === 'undefined' || window.electronAPI) return;

  window.electronAPI = {
    // The direct socket path handles messaging; token travels via auth /
    // payload exactly as browser mode does.
    sendMessage: async (payload: unknown) => {
      const s = await getSocket();
      const p = (payload ?? {}) as Record<string, unknown>;
      const token = (() => {
        try { return localStorage.getItem('aiconv_token'); } catch { return null; }
      })();
      s.emit('user:message', { ...p, token: p.token ?? token });
      return { ok: true };
    },

    emit: async (cmd: string, payload?: unknown) => {
      const s = await getSocket();
      const token = (() => {
        try { return localStorage.getItem('aiconv_token'); } catch { return null; }
      })();
      // Backend auth falls back to a token field in the payload; mirror the
      // Electron bridge's token injection. ACK_AS_FIRST_ARG commands take NO
      // payload — their auth comes from the socket handshake instead.
      const finalPayload =
        payload && typeof payload === 'object'
          ? { ...(payload as Record<string, unknown>), token: (payload as Record<string, unknown>).token ?? token }
          : payload;
      try {
        const data = ACK_AS_FIRST_ARG.has(cmd)
          ? await s.emitWithAck(cmd)
          : await s.emitWithAck(cmd, finalPayload ?? null);
        if (data && typeof data === 'object' && 'ok' in data && (data as Ack).ok === false) {
          return { ok: false, error: (data as Ack).error ?? 'Command failed' };
        }
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    on: (event: string, callback: (payload: unknown) => void) => {
      let unsubscribed = false;
      let bound: ((payload: unknown) => void) | null = null;
      getSocket().then((s) => {
        if (unsubscribed) return;
        bound = callback;
        s.on(event, bound);
      });
      return () => {
        unsubscribed = true;
        if (socket && bound) socket.off(event, bound);
      };
    },

    configureBackend: async (_url?: string, token?: string) => {
      // Single-host app: reconnect the shared socket with the fresh token.
      const s = await getSocket();
      if (token) {
        s.auth = { token };
        s.disconnect().connect();
      }
      return { ok: true };
    },

    getBridgeStatus: async () => {
      const s = await getSocket();
      return { ok: true, connected: s.connected };
    },

    // Desktop-only: VRAM report for the persona modal / Settings badges.
    getGpuInfo: () => invoke<GpuInfoResult>('gpu_info'),
  };
}

export interface GpuInfoResult {
  available: boolean;
  name?: string;
  total_mib?: number;
  used_mib?: number;
}
