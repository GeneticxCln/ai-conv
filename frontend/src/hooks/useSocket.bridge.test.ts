/**
 * useSocket bridge transport test
 *
 * Mocks React hooks and socket.io-client to verify that useSocket selects the
 * Electron IPC bridge when window.electronAPI is present, and falls back to
 * socket.io-client when it is absent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -------------------------------------------------------------------
// Minimal window / localStorage polyfill for Node test env
// -------------------------------------------------------------------
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {};
}
// The app resolves its backend URL from window.location.origin (same-origin
// desktop shells); polyfill a browser-like origin for the Node test env.
if (!(globalThis as any).window.location) {
  (globalThis as any).window.location = { origin: 'http://localhost:5173' };
}
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}

// -------------------------------------------------------------------
// Mock React hooks so useSocket can execute outside a component tree
// -------------------------------------------------------------------
const refs = new Map<string, any>();
let stateIndex = 0;

// Track connected state per test
let connectedState = true;

vi.mock('react', async () => {
  const actual: any = await vi.importActual('react');
  return {
    ...actual,
    useRef: (initial?: any) => {
      const key = String(refs.size);
      if (!refs.has(key)) refs.set(key, { current: initial });
      return refs.get(key);
    },
    useState: (initial: any) => {
      const key = `state_${stateIndex++}`;
      // For connected state, use the shared connectedState
      const value = { current: initial };
      refs.set(key, value);
      const setState = (newValue: any) => {
        value.current = typeof newValue === 'function' ? newValue(value.current) : newValue;
      };
      // If initial is false, it's the connected state - use our shared state
      return [initial === false ? connectedState : value.current, setState];
    },
    // useEffect: run immediately so setup happens synchronously in tests.
    useEffect: (fn: () => void | (() => void), _deps?: any[]) => {
      // Store the cleanup for potential teardown testing; run effect now.
      fn();
    },
    useCallback: (fn: any) => fn,
  };
});

// -------------------------------------------------------------------
// Mock socket.io-client
// -------------------------------------------------------------------
const mockSocketOn = vi.fn();
const mockSocketOff = vi.fn();
const mockSocketEmit = vi.fn();
const mockSocketEmitWithAck = vi.fn();
const mockSocketDisconnect = vi.fn();
const mockSocketConnect = vi.fn();
const mockSocket = {
  id: 'mock-socket-id',
  connected: true,
  on: mockSocketOn,
  off: mockSocketOff,
  emit: mockSocketEmit,
  emitWithAck: mockSocketEmitWithAck,
  disconnect: mockSocketDisconnect,
  connect: mockSocketConnect,
  auth: { token: null },
};

vi.mock('socket.io-client', () => {
  const io = vi.fn(() => mockSocket);
  return { io };
});

// -------------------------------------------------------------------
// Mock zustand store
// -------------------------------------------------------------------
const storeState: Record<string, unknown> = {
  setConnected: vi.fn(),
  addMessage: vi.fn(),
  updateMessage: vi.fn(),
  setMessages: vi.fn(),
  setAgents: vi.fn(),
  setConversations: vi.fn(),
  setCurrentConversation: vi.fn(),
  addConversation: vi.fn(),
  removeConversation: vi.fn(),
  clearAllConversations: vi.fn(),
  removeMessage: vi.fn(),
  startStreaming: vi.fn(),
  stopStreaming: vi.fn(),
  setAwaitingFirstToken: vi.fn(),
  currentConversationId: null,
  currentUser: null,
  agents: [],
  messages: {},
  pullProgress: {},
  conversations: [],
  streamingMessages: {},
  setPullProgress: vi.fn(),
  clearStalePullProgress: vi.fn(),
  prependMessages: vi.fn(),
};

vi.mock('../stores/useChatStore', () => {
  // useChatStore is used two ways:
  // 1. useChatStore(selector) — in the hook body, returns selector(store)
  // 2. useChatStore.getState() — in callbacks, returns the raw store
  const hookFn = (selector?: (s: typeof storeState) => unknown) =>
    typeof selector === 'function' ? selector(storeState) : storeState;
  hookFn.getState = () => storeState;
  return { useChatStore: hookFn };
});

vi.mock('../lib/streaming', () => ({
  applyAgentToken: vi.fn(),
}));

// -------------------------------------------------------------------
// Lifecycle
// -------------------------------------------------------------------
let originalElectronAPI: unknown;

beforeEach(() => {
  originalElectronAPI = (window as any).electronAPI;
  refs.clear();
  stateIndex = 0;
  connectedState = true;  // Reset connected state to true for each test
  vi.clearAllMocks();
  mockSocket.connected = true;
  mockSocket.emit.mockClear();
  mockSocket.emitWithAck.mockClear();
});

afterEach(() => {
  (window as any).electronAPI = originalElectronAPI;
});

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe('useSocket transport selection', () => {
  it('does NOT call socket.io-client io() when electronAPI is present (bridge path)', async () => {
    const { io } = await import('socket.io-client');
    const mockIo = vi.mocked(io);

    const bridgeOn = vi.fn(() => vi.fn());
    const bridgeConfigure = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electronAPI = {
      sendMessage: vi.fn(),
      emit: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      on: bridgeOn,
      configureBackend: bridgeConfigure,
      getBridgeStatus: vi.fn().mockResolvedValue({ ok: true, connected: true }),
    };

    const { useSocket } = await import('./useSocket');
    useSocket();

    // Bridge path chosen; socket.io-client io() must NOT be called.
    expect(mockIo).not.toHaveBeenCalled();
    expect(bridgeOn).toHaveBeenCalled();
    // configureBackend is skipped when no auth token exists (first launch).
    // getBridgeStatus should have been called instead to sync connection state.
    expect(bridgeConfigure).not.toHaveBeenCalled();
    expect((window as any).electronAPI.getBridgeStatus).toHaveBeenCalled();
  });

  it('calls socket.io-client io() when electronAPI is absent (socket fallback)', async () => {
    const { io } = await import('socket.io-client');
    const mockIo = vi.mocked(io);

    (window as any).electronAPI = undefined;

    const { useSocket } = await import('./useSocket');
    useSocket();

    // Without the bridge, socket.io-client must be used.
    expect(mockIo).toHaveBeenCalledTimes(1);
    expect(mockSocketOn).toHaveBeenCalled();
  });

  it('sendMessage() routes through electronAPI.emit when bridge is present', async () => {
    const bridgeEmit = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electronAPI = {
      sendMessage: vi.fn(),
      emit: bridgeEmit,
      on: vi.fn(() => vi.fn()),
      configureBackend: vi.fn().mockResolvedValue({ ok: true }),
      getBridgeStatus: vi.fn().mockResolvedValue({ ok: true, connected: true }),
    };

    const { useSocket } = await import('./useSocket');
    const actions = useSocket();

    actions.sendMessage('conv-1', 'Hello from IPC', { agentChat: false });

    expect(bridgeEmit).toHaveBeenCalledTimes(1);
    const sent = bridgeEmit.mock.calls[0][0];
    expect(sent).toBe('user:message');
    const payload = bridgeEmit.mock.calls[0][1];
    expect(payload).toMatchObject({
      conversationId: 'conv-1',
      content: 'Hello from IPC',
      agentChat: false,
    });
    // Note: token is injected by preload, not by useSocketActions
  });

  it('sendMessage() calls socket.emit("user:message",…) when bridge is absent', async () => {
    const { io } = await import('socket.io-client');
    vi.mocked(io).mockReturnValue(mockSocket as any);
    (window as any).electronAPI = undefined;

    const { useSocket } = await import('./useSocket');
    const actions = useSocket();

    actions.sendMessage('conv-2', 'Hello from socket', { agentChat: false });

    expect(mockSocketEmit).toHaveBeenCalledWith(
      'user:message',
      expect.objectContaining({ conversationId: 'conv-2', content: 'Hello from socket' })
    );
  });

  it('emit() routes through electronAPI.emit when bridge is present', async () => {
    const bridgeEmit = vi.fn().mockResolvedValue({ ok: true, data: ['qwen3.8:27b'] });
    (window as any).electronAPI = {
      sendMessage: vi.fn(),
      emit: bridgeEmit,
      on: vi.fn(() => vi.fn()),
      configureBackend: vi.fn().mockResolvedValue({ ok: true }),
      getBridgeStatus: vi.fn().mockResolvedValue({ ok: true, connected: true }),
    };

    const { useSocket } = await import('./useSocket');
    const actions = useSocket();

    const result = await actions.getModels();

    expect(bridgeEmit).toHaveBeenCalledWith('models:list', undefined);
    // emitWithAck now unwraps the bridge envelope { ok, data } → data
    expect(result).toEqual(['qwen3.8:27b']);
  });

  it('emit() calls socket.emitWithAck when bridge is absent', async () => {
    const { io } = await import('socket.io-client');
    vi.mocked(io).mockReturnValue(mockSocket as any);
    (window as any).electronAPI = undefined;
    mockSocketEmitWithAck.mockResolvedValue(['gemma4']);

    const { useSocket } = await import('./useSocket');
    const actions = useSocket();

    const result = await actions.getModels();

    // An explicit `undefined` payload must NOT be sent: socket.io serializes
    // it as a positional argument, which shifts the server's `(ack?)` handler
    // and loses the callback. Emit with no payload at all.
    expect(mockSocketEmitWithAck).toHaveBeenCalledWith('models:list');
    expect(result).toEqual(['gemma4']);
  });

  it('getModelsFull() routes through electronAPI.emit when bridge is present', async () => {
    const full = [
      { name: 'qwen2.5:0.5b', size: 397_000_000, parameterSize: '494.03M', capabilities: ['completion'] },
      { name: 'nomic-embed-text:latest', size: 274_302_450, parameterSize: '137M', capabilities: ['embedding'] },
    ];
    const bridgeEmit = vi.fn().mockResolvedValue({ ok: true, data: full });
    (window as any).electronAPI = {
      sendMessage: vi.fn(),
      emit: bridgeEmit,
      on: vi.fn(() => vi.fn()),
      configureBackend: vi.fn().mockResolvedValue({ ok: true }),
      getBridgeStatus: vi.fn().mockResolvedValue({ ok: true, connected: true }),
    };

    const { useSocket } = await import('./useSocket');
    const actions = useSocket();

    const result = await actions.getModelsFull();

    expect(bridgeEmit).toHaveBeenCalledWith('models:list:full', undefined);
    expect(result).toEqual(full);
  });

  it('createConversation() uses an acknowledged bridge command and selects the result', async () => {
    const conversation = {
      id: 'conv-created',
      title: 'New Conversation',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    };
    const bridgeEmit = vi.fn().mockResolvedValue({ ok: true, data: { ok: true, conversation } });
    (window as any).electronAPI = {
      sendMessage: vi.fn(),
      emit: bridgeEmit,
      on: vi.fn(() => vi.fn()),
      configureBackend: vi.fn().mockResolvedValue({ ok: true }),
      getBridgeStatus: vi.fn().mockResolvedValue({ ok: true, connected: true }),
    };

    const { useSocket } = await import('./useSocket');
    const actions = useSocket();
    const result = await actions.createConversation();

    expect(bridgeEmit).toHaveBeenCalledWith('conversation:create', null);
    expect(result).toEqual(conversation);
    expect(storeState.addConversation).toHaveBeenCalledWith(conversation);
    expect(storeState.setCurrentConversation).toHaveBeenCalledWith('conv-created');
  });

  it('createConversation() sends null title so direct socket ack is not shifted', async () => {
    const { io } = await import('socket.io-client');
    vi.mocked(io).mockReturnValue(mockSocket as any);
    (window as any).electronAPI = undefined;
    const conversation = {
      id: 'conv-created',
      title: 'New Conversation',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    };
    mockSocketEmitWithAck.mockResolvedValue({ ok: true, conversation });

    const { useSocket } = await import('./useSocket');
    const actions = useSocket();
    const result = await actions.createConversation();

    expect(mockSocketEmitWithAck).toHaveBeenCalledWith('conversation:create', null);
    expect(result).toEqual(conversation);
  });

  it('getModelsFull() calls socket.emitWithAck with no payload when bridge is absent', async () => {
    const { io } = await import('socket.io-client');
    vi.mocked(io).mockReturnValue(mockSocket as any);
    (window as any).electronAPI = undefined;
    mockSocketEmitWithAck.mockResolvedValue([{ name: 'gemma4', size: 9_608_350_718, parameterSize: '8.0B' }]);

    const { useSocket } = await import('./useSocket');
    const actions = useSocket();

    const result = await actions.getModelsFull();

    expect(mockSocketEmitWithAck).toHaveBeenCalledWith('models:list:full');
    expect(result).toEqual([{ name: 'gemma4', size: 9_608_350_718, parameterSize: '8.0B' }]);
  });
});
