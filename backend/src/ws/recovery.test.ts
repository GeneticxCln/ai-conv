import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';

vi.hoisted(() => {
  process.env.DATABASE_PATH ||= `/tmp/ai-conv-recovery-${process.pid}.db`;
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-recovery-secret-key-64-chars-long-for-hs256-hmac';
});

vi.mock('../llm/ollama.js', () => ({
  streamChat: vi.fn(),
  ollama: {
    list: vi.fn().mockResolvedValue({ models: [{ name: 'test-model:latest' }] }),
    pull: vi.fn(),
  },
  ensureModel: vi.fn().mockResolvedValue(true),
  validateModel: vi.fn().mockResolvedValue({ valid: true, availableModels: ['test-model:latest'] }),
  registerStream: vi.fn().mockReturnValue({ signal: new AbortController().signal }),
  releaseStream: vi.fn(),
  abortStreamsForConversation: vi.fn(),
}));

vi.mock('../redis/client.js', () => ({
  connectRedis: vi.fn().mockRejectedValue(new Error('no redis')),
  disconnectRedis: vi.fn(),
  getRedisClient: vi.fn().mockReturnValue(null),
}));

vi.mock('../redis/rateLimiter.js', () => ({
  checkPullRateLimit: vi.fn().mockResolvedValue(true),
  checkMessageRateLimit: vi.fn().mockResolvedValue(true),
  checkCreateRateLimit: vi.fn().mockResolvedValue(true),
  checkRegenerateRateLimit: vi.fn().mockResolvedValue(true),
  cleanupRateLimit: vi.fn(),
}));

import { setupSocketHandler } from './handler';
import { AgentRegistry } from '../agents/index.js';
import { db } from '../storage/db.js';

beforeEach(() => {
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM personas; DELETE FROM users;');
});

/**
 * Regression coverage for the stale-token recovery path (users:list:bootstrap,
 * user:select, user:create). The recovery surface MUST be restricted to
 * loopback clients: a remote anonymous client must never enumerate profiles
 * or bind to one. A query flag lets the test spoof a non-loopback address via
 * middleware, since a test process always connects from 127.0.0.1.
 */
describe('stale-token recovery restricted to loopback clients', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: Server;
  let url: string;

  beforeEach(async () => {
    httpServer = createServer();
    io = new Server(httpServer, {
      transports: ['websocket', 'polling'],
      cors: { origin: '*' },
    });
    httpServer.listen(0);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const port = (httpServer.address() as { port: number }).port;
    url = `http://127.0.0.1:${port}`;

    // Spoof the client address BEFORE the auth middleware runs.
    io.use((socket, next) => {
      const spoof = socket.handshake.query?.spoofAddr;
      if (typeof spoof === 'string') socket.handshake.address = spoof;
      next();
    });

    setupSocketHandler(io, new AgentRegistry(io));
  });

  function connect(spoofAddr?: string) {
    return ioc(url, {
      transports: ['websocket'],
      reconnection: false,
      query: spoofAddr ? { spoofAddr } : undefined,
    });
  }

  async function seedUser(): Promise<string> {
    const c = connect();
    await new Promise((res) => c.once('connect', res));
    const r = (await c.emitWithAck('user:create', { name: 'Sasha' })) as {
      user?: { id: string };
    };
    c.close();
    if (!r.user?.id) throw new Error('seed failed');
    return r.user.id;
  }

  it('anonymous loopback client can enumerate profiles and select one (recovery)', async () => {
    const userId = await seedUser();
    const c = connect();
    await new Promise((res) => c.once('connect', res));

    const list = (await c.emitWithAck('users:list:bootstrap')) as Array<{ id: string; name: string }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((u) => u.id === userId)).toBe(true);

    const sel = (await c.emitWithAck('user:select', userId)) as {
      ok?: boolean;
      token?: string;
      user?: { id: string };
    };
    expect(sel.ok).not.toBe(false);
    expect(sel.token).toBeTruthy();
    expect(sel.user?.id).toBe(userId);
    c.close();
  });

  it('remote anonymous client CANNOT enumerate profiles via users:list:bootstrap', async () => {
    await seedUser();
    const c = connect('192.168.178.99');
    await new Promise((res) => c.once('connect', res));

    const ack = (await c.emitWithAck('users:list:bootstrap')) as { ok?: boolean; error?: string };
    expect(ack.ok).toBe(false);
    expect(ack.error).toBeTruthy();
    c.close();
  });

  it('remote anonymous client CANNOT bind to a profile via user:select', async () => {
    const userId = await seedUser();
    const c = connect('192.168.178.99');
    await new Promise((res) => c.once('connect', res));

    const ack = (await c.emitWithAck('user:select', userId)) as { ok?: boolean; error?: string };
    expect(ack.ok).toBe(false);
    expect(ack.error).toBeTruthy();
    c.close();
  });

  it('remote anonymous client CANNOT create another profile once users exist', async () => {
    await seedUser();
    const c = connect('10.0.0.42');
    await new Promise((res) => c.once('connect', res));

    const ack = (await c.emitWithAck('user:create', { name: 'Evil' })) as { ok?: boolean; error?: string };
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('Authentication required');
    c.close();
  });

  it('loopback anonymous client CAN create another profile (recovery)', async () => {
    await seedUser();
    const c = connect();
    await new Promise((res) => c.once('connect', res));

    const ack = (await c.emitWithAck('user:create', { name: 'Recovered' })) as {
      ok?: boolean;
      token?: string;
      user?: { name: string };
    };
    expect(ack.ok).not.toBe(false);
    expect(ack.token).toBeTruthy();
    expect(ack.user?.name).toBe('Recovered');
    c.close();
  });
});
