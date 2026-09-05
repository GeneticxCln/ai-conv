import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useChatStore } from '../stores/useChatStore';

const withTimeout = <T>(promise: Promise<T>, ms: number, timeoutError: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(timeoutError)), ms)),
  ]);

// Connect directly to the backend. Same-origin by default: the desktop
// shells (Tauri and packaged Electron) load the app FROM the backend, so
// window.location.origin already points at it — no hardcoded host, and no
// localhost→::1 IPv6 resolution issues inside WebKitGTK. VITE_WS_URL remains
// the dev/browser override. (Guarded for Node test environments.)
const WS_URL: string =
  import.meta.env.VITE_WS_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('aiconv_token');
}

// Shared global type for the Tauri desktop adapter (src/lib/tauriAdapter.ts).
// In the Tauri window this is installed at startup and the app talks to the
// backend through its same-origin socket — exactly the surface the old
// Electron preload bridge exposed, now backed by socket.io directly.
declare global {
  interface Window {
    electronAPI?: {
      sendMessage: (payload: unknown) => Promise<{ ok: boolean; error?: string }>;
      emit: (cmd: string, payload?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      on: (event: string, callback: (payload: any) => void) => () => void;
      configureBackend: (url?: string, token?: string) => Promise<{ ok: boolean; error?: string }>;
      getBridgeStatus: () => Promise<{ ok: boolean; connected: boolean }>;
      [key: string]: any;
    };
  }
}

function isBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

export interface SocketConnection {
  socket: Socket | null;
  usingBridge: boolean;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  onEvent: (event: string, callback: (payload: any) => void) => () => void;
  emit: (event: string, payload?: any) => void;
  emitWithAck: <T>(event: string, payload?: any, timeout?: number) => Promise<T>;
  applyAuthToken: (token: string) => Promise<void>;
}

/**
 * Hook managing the socket connection lifecycle.
 * Handles both Electron IPC bridge and direct WebSocket transport.
 */
export function useSocketConnection(): SocketConnection {
  const socketRef = useRef<Socket | null>(null);
  const usingBridgeRef = useRef(false);
  const bridgeConnectedRef = useRef(false);
  const unsubsRef = useRef<Array<() => void>>([]);
  const [connected, setConnected] = useState(false);
  const setStoreConnected = useCallback((value: boolean) => {
    setConnected(value);
    useChatStore.getState().setConnected(value);
  }, []);

  // Store current values in state to avoid accessing refs during render
  const [socket, setSocket] = useState<Socket | null>(null);
  const [usingBridge, setUsingBridge] = useState(false);

  const connect = useCallback(async () => {
    // Idempotent: if a socket is already alive (or a reconnect is in flight),
    // do not create a duplicate. StrictMode remounts call connect() again
    // after disconnect() has nulled the ref, so a fresh socket is created then.
    if (socketRef.current && (socketRef.current.connected || socketRef.current.active)) {
      return;
    }
    const bridgeAvailable = isBridgeAvailable();
    usingBridgeRef.current = bridgeAvailable;
    setUsingBridge(bridgeAvailable);

    if (bridgeAvailable) {
      // Electron IPC bridge mode. The main process starts an anonymous
      // bridge, then this hook replaces it with a token-bound bridge when a
      // persisted profile token exists. First launch remains anonymous.
      bridgeConnectedRef.current = true;
      setStoreConnected(true);

      // Listen before re-authenticating: an invalid persisted token can be
      // rejected immediately, and missing that event leaves the UI green but
      // unable to create conversations or personas.
      const clearBridgeAuth = () => {
        if (typeof window !== 'undefined') localStorage.removeItem('aiconv_token');
        useChatStore.getState().setCurrentUser(null);
      };
      const unsubConnect = window.electronAPI!.on('connect', () => {
        bridgeConnectedRef.current = true;
        setStoreConnected(true);
      });
      const unsubDisconnect = window.electronAPI!.on('disconnect', () => {
        bridgeConnectedRef.current = false;
        setStoreConnected(false);
      });
      const unsubAuthError = window.electronAPI!.on('auth-error', clearBridgeAuth);
      unsubsRef.current.push(unsubConnect, unsubDisconnect, unsubAuthError);

      // A persisted renderer token must be applied to the main-process
      // bridge before scoped list requests are allowed. First launch has no
      // token and remains the sole anonymous bootstrap state.
      const token = getAuthToken();
      if (token) {
        try {
          const result = await window.electronAPI!.configureBackend(undefined, token);
          if (result?.ok === false) clearBridgeAuth();
        } catch {
          clearBridgeAuth();
        }
      }

      try {
        // Double-check actual connection state after the auth bridge settles.
        const status = await window.electronAPI!.getBridgeStatus();
        bridgeConnectedRef.current = status.connected;
        setStoreConnected(status.connected);
      } catch {
        // Bridge is still available, just not answering status right now.
        // Keep connected=true — it was set above.
      }
      setSocket(null);
    } else {
      // Direct socket.io — polling first, auto-upgrades to WebSocket.
      const token = getAuthToken();
      console.log('[Socket] Connecting directly to', WS_URL);
      const newSocket = io(WS_URL, {
        auth: token ? { token } : undefined,
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      socketRef.current = newSocket;
      setSocket(newSocket);

      newSocket.on('connect', () => {
        setStoreConnected(true);
        if (getAuthToken()) {
          newSocket.emit('session:current', (user: unknown) => {
            if (user) useChatStore.getState().setCurrentUser(user as any);
          });
          newSocket.emit('personas:list');
          newSocket.emit('conversation:list');
        }
      });

      newSocket.on('disconnect', () => {
        setStoreConnected(false);
      });

      newSocket.on('connect_error', (err) => {
        console.error('[Socket] Connection error:', err.message);
        if (/invalid token|user not found/i.test(err.message)) {
          localStorage.removeItem('aiconv_token');
          useChatStore.getState().setCurrentUser(null);
        }
      });
    }
  }, [setStoreConnected]);

  const applyAuthToken = useCallback(async (token: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('aiconv_token', token);

    // The server rebinds the existing socket during user:create/user:select.
    // Persist the token for future reconnects; Electron also needs to update
    // the main-process bridge's handshake credentials.
    if (usingBridgeRef.current && typeof window !== 'undefined' && window.electronAPI) {
      await window.electronAPI.configureBackend(undefined, token);
      return;
    }

    const current = socketRef.current;
    if (current) current.auth = { token };
  }, []);

  const disconnect = useCallback(() => {
    // Clean up bridge listeners
    for (const unsub of unsubsRef.current) {
      try { unsub(); } catch { /* ignore */ }
    }
    unsubsRef.current = [];

    // Close direct socket
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    
    usingBridgeRef.current = false;
    bridgeConnectedRef.current = false;
    setStoreConnected(false);
    setUsingBridge(false);
    setSocket(null);
  }, [setStoreConnected]);

  const onEvent = useCallback((event: string, callback: (payload: any) => void): (() => void) => {
    if (usingBridgeRef.current) {
      const unsub = window.electronAPI!.on(event, callback);
      unsubsRef.current.push(unsub);
      return unsub;
    }
    
    if (socketRef.current) {
      socketRef.current.on(event, callback);
      return () => socketRef.current?.off(event, callback);
    }
    
    return () => {};
  }, []);

  const emit = useCallback((event: string, payload?: any) => {
    if (usingBridgeRef.current) {
      window.electronAPI!.emit(event, payload);
      return;
    }
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, payload);
    }
  }, []);

  const emitWithAck = useCallback(async <T>(event: string, payload?: any, timeout = 8000): Promise<T> => {
    if (usingBridgeRef.current) {
      const raw = await withTimeout(window.electronAPI!.emit(event, payload), timeout, `${event} timeout`);
      // Bridge wraps all responses in { ok, data } — unwrap for caller
      if (raw && typeof raw === 'object' && 'ok' in raw && 'data' in raw) {
        return (raw as any).data as T;
      }
      return raw as T;
    }
    if (socketRef.current?.connected) {
      // Passing an explicit `undefined` payload makes socket.io treat it as a
      // positional argument, so the server's `(ack?)` handlers receive
      // `undefined` as the first arg and never get the ack callback. Omit the
      // payload entirely when there is none.
      const ackPromise =
        payload === undefined
          ? socketRef.current.emitWithAck(event)
          : socketRef.current.emitWithAck(event, payload);
      return withTimeout(ackPromise, timeout, `${event} ack timeout`) as Promise<T>;
    }
    throw new Error('Not connected');
  }, []);

  // Auto-connect on mount. React StrictMode double-invokes effects in dev:
  // mount → connect, simulated unmount → disconnect, remount → connect again.
  // connect() must be idempotent so the remount re-establishes the socket.
  useEffect(() => {
    // This effect owns the external socket lifecycle; connect() updates the
    // local connection indicator as that external system becomes available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    socket,
    usingBridge,
    connected,
    connect,
    disconnect,
    onEvent,
    emit,
    emitWithAck,
    applyAuthToken,
  };
}
