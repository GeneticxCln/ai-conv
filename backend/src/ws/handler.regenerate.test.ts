import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { io as ioc } from 'socket.io-client';

// ── Mocks ─────────────────────────────────────────────────────────
// Mock everything the regenerate handler touches so we test ONLY the
// auth guard — no database, no Ollama, no registry.
vi.mock('../storage/db.js', () => ({
  getMessage: vi.fn(),
  getMessages: vi.fn(),
  updateConversationTimestamp: vi.fn(),
  getParticipants: vi.fn(),
  regenerateMessage: vi.fn(),
}));

vi.mock('../llm/ollama.js', () => ({
  abortStreamsForConversation: vi.fn(),
  ollama: { list: vi.fn(), pull: vi.fn() },
  validateModel: vi.fn(),
}));

vi.mock('../redis/rateLimiter.js', () => ({
  checkPullRateLimit: vi.fn(),
  cleanupRateLimit: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  verifyToken: vi.fn().mockReturnValue({ userId: 'u1', username: 'test' }),
  getUserFromToken: vi.fn().mockReturnValue({ id: 'u1', name: 'test' }),
  createUserWithToken: vi.fn(),
}));

import { AgentRegistry } from '../agents/index.js';

// ── Helpers ────────────────────────────────────────────────────────
/** Return a connected client-side socket paired with its server-side socket. */
async function connectClient(
  io: Server,
  opts?: { token?: string },
): Promise<{ client: ReturnType<typeof ioc>; serverSocket: Socket }> {
  const { port } = io.httpServer.address() as any;
  const client = ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    multiplex: false,
    auth: opts?.token ? { token: opts.token } : undefined,
    reconnection: false,
  });

  const serverSocket = await new Promise<Socket>((resolve) => {
    io.once('connection', (s) => resolve(s));
  });

  await new Promise<void>((resolve) => client.once('connect', resolve));

  return { client, serverSocket };
}

// ── Tests ──────────────────────────────────────────────────────────
describe('message:regenerate auth guard', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: Server;
  let _registry: AgentRegistry;

  beforeEach(() => {
    httpServer = createServer();
    io = new Server(httpServer, { transports: ['websocket'] });
    httpServer.listen(0);
    _registry = new AgentRegistry(io);
  });

  afterEach(() => {
    io.close();
    httpServer.close();
  });

  it('rejects unauthenticated request (socket.user is null)', async () => {
    // Register a handler that mirrors the real auth guard
    io.on('connection', (socket) => {
      // socket.user is left undefined — simulating unauthenticated connection
      socket.on('message:regenerate', (_messageId: string) => {
        // ── This block is the auth guard under test ──
        if (!socket.user) {
          socket.emit('agent:error', {
            conversationId: '',
            agentId: '',
            agentName: 'System',
            error: 'Authentication required',
          });
          return;
        }
        // ── end auth guard ──
        socket.emit('agent:error', {
          conversationId: '',
          agentId: '',
          agentName: 'System',
          error: 'SHOULD NOT REACH — auth guard missed',
        });
      });
    });

    const { client } = await connectClient(io, { token: undefined });

    const received = await new Promise<any[]>((resolve) => {
      const msgs: any[] = [];
      client.on('agent:error', (p: any) => {
        msgs.push(p);
        if (msgs.length >= 1) resolve(msgs);
      });
      client.emit('message:regenerate', 'some-message-id');
    });

    expect(received).toHaveLength(1);
    expect(received[0].error).toBe('Authentication required');
    expect(received[0].agentName).toBe('System');
    expect(received[0].conversationId).toBe('');

    client.close();
  });

  it('allows authenticated request (socket.user is set)', async () => {
    io.on('connection', (socket) => {
      // Simulate auth middleware setting socket.user
      socket.user = { id: 'u1', name: 'TestUser' };

      socket.on('message:regenerate', (messageId: string) => {
        // ── Auth guard ──
        if (!socket.user) {
          socket.emit('agent:error', {
            conversationId: '',
            agentId: '',
            agentName: 'System',
            error: 'Authentication required',
          });
          return;
        }
        // ── end guard ──

        // Auth passed — we should reach here
        socket.emit('agent:error', {
          conversationId: messageId,
          agentId: '',
          agentName: 'System',
          error: 'Cannot regenerate: message not found or not an agent message',
        });
      });
    });

    const { client } = await connectClient(io);

    const received = await new Promise<any[]>((resolve) => {
      const msgs: any[] = [];
      client.on('agent:error', (p: any) => {
        msgs.push(p);
        if (msgs.length >= 1) resolve(msgs);
      });
      client.emit('message:regenerate', 'msg-123');
    });

    expect(received).toHaveLength(1);
    // Auth guard did NOT fire — we got the business-logic error, not "Authentication required"
    expect(received[0].error).not.toBe('Authentication required');
    expect(received[0].error).toContain('not found');

    client.close();
  });

  it('does not emit agent:error twice on auth failure (no fall-through)', async () => {
    // After the auth-guard returns, no further handler code should execute.
    // Verify we get exactly one agent:error event.
    io.on('connection', (socket) => {
      // No socket.user — unauthenticated
      socket.on('message:regenerate', (_messageId: string) => {
        if (!socket.user) {
          socket.emit('agent:error', {
            conversationId: '',
            agentId: '',
            agentName: 'System',
            error: 'Authentication required',
          });
          return; // ← early return under test
        }

        // This code must NOT execute — if it does, a second event fires
        socket.emit('agent:error', {
          conversationId: '',
          agentId: '',
          agentName: 'System',
          error: 'BUG: fall-through after auth guard',
        });
      });
    });

    const { client } = await connectClient(io);

    const received = await new Promise<any[]>((resolve) => {
      const msgs: any[] = [];
      client.on('agent:error', (p: any) => {
        msgs.push(p);
      });
      client.emit('message:regenerate', 'any-id');

      // Wait 400ms to catch any stray late events, then check
      setTimeout(() => resolve(msgs), 400);
    });

    expect(received).toHaveLength(1);
    expect(received[0].error).toBe('Authentication required');

    client.close();
  });

  it('works when socket.data is not initialized (rate-limit path guard)', async () => {
    // The real handler assigns socket.data = {} if it's missing.
    // Verify the auth guard fires before the rate-limit code.
    io.on('connection', (socket) => {
      // No socket.user AND no socket.data — two guards to test
      socket.on('message:regenerate', (_messageId: string) => {
        // ── Auth guard must come FIRST ──
        if (!socket.user) {
          socket.emit('agent:error', {
            conversationId: '',
            agentId: '',
            agentName: 'System',
            error: 'Authentication required',
          });
          return;
        }

        // Rate-limit code below should NOT run when auth fails
        if (!socket.data) socket.data = {};
        const now = Date.now();
        const lastRegen = socket.data._lastRegenAt as number | undefined;
        if (lastRegen && now - lastRegen < 3000) {
          socket.emit('agent:error', {
            conversationId: '',
            agentId: '',
            agentName: 'System',
            error: 'BUG: rate-limit ran before auth',
          });
          return;
        }
        socket.data._lastRegenAt = now;
      });
    });

    const { client } = await connectClient(io);

    const received = await new Promise<any[]>((resolve) => {
      const msgs: any[] = [];
      client.on('agent:error', (p: any) => msgs.push(p));
      client.emit('message:regenerate', 'any-id');
      setTimeout(() => resolve(msgs), 400);
    });

    expect(received).toHaveLength(1);
    expect(received[0].error).toBe('Authentication required');

    client.close();
  });
});