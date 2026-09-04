import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';

vi.hoisted(() => {
  process.env.DATABASE_PATH ||= `/tmp/ai-conv-regenerate-int-${process.pid}.db`;
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-integration-secret-key-64-chars-long-for-hs256-hmac';
});

let responseIndex = 0;
const responses = ['First response from agent', 'Second regenerated response'];

vi.mock('../llm/ollama.js', () => {
  async function* fakeStream() {
    const text = responses[responseIndex];
    responseIndex = (responseIndex + 1) % responses.length;
    for (let i = 0; i < text.length; i += 1) yield { token: text[i], done: false };
    yield { token: '', done: true };
  }

  return {
    streamChat: vi.fn().mockImplementation(() => fakeStream()),
    ollama: {
      list: vi.fn().mockResolvedValue({ models: [{ name: 'test-model:latest' }] }),
      pull: vi.fn(),
    },
    ensureModel: vi.fn().mockResolvedValue(true),
    validateModel: vi.fn().mockResolvedValue({ valid: true, availableModels: ['test-model:latest'] }),
    registerStream: vi.fn().mockReturnValue({ signal: new AbortController().signal }),
    releaseStream: vi.fn(),
    abortStreamsForConversation: vi.fn(),
  };
});

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
  responseIndex = 0;
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM personas; DELETE FROM users;');
});

afterEach(() => {
  responseIndex = 0;
});

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('message:regenerate integration', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: Server;
  let client: ReturnType<typeof ioc>;
  let token: string;

  beforeEach(async () => {
    httpServer = createServer();
    io = new Server(httpServer, {
      transports: ['websocket', 'polling'],
      cors: { origin: '*' },
    });
    httpServer.listen(0);

    const registry = new AgentRegistry(io);
    setupSocketHandler(io, registry);

    const { port } = httpServer.address() as { port: number };
    client = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      multiplex: false,
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });

    const userResult = await client.emitWithAck('user:create', { name: 'IntTestUser' }) as {
      token?: string;
      error?: string;
    };
    expect(userResult.token, userResult.error).toBeDefined();
    token = userResult.token!;
    client.close();
    await delay(100);
  });

  afterEach(() => {
    try { client?.close(); } catch { /* ignore */ }
    try { io?.close(); } catch { /* ignore */ }
    try { httpServer?.close(); } catch { /* ignore */ }
  });

  it('sends message, gets agent response, regenerates, and gets a different response', async () => {
    const { port } = httpServer.address() as { port: number };
    client = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      multiplex: false,
      reconnection: false,
      auth: { token },
    });
    await new Promise<void>((resolve) => client.once('connect', resolve));

    const personaPromise = new Promise<void>((resolve) => {
      client.once('personas:list', (personas: any[]) => {
        if (personas.length > 0) resolve();
      });
    });
    client.emit('persona:create', {
      name: 'TestBot',
      model: 'test-model:latest',
      systemPrompt: 'You are a test bot.',
      temperature: 0.7,
      enabled: true,
    });
    await personaPromise;

    const convPromise = new Promise<any>((resolve) => client.once('conversation:created', resolve));
    client.emit('conversation:create', 'Integration Test');
    const conv = await convPromise;
    const conversationId = conv.id;

    const historyPromise = new Promise<any>((resolve) => client.once('messages:history', resolve));
    client.emit('join', conversationId);
    await historyPromise;

    const agentTokens: any[] = [];
    const agentDones: any[] = [];
    client.on('agent:token', (payload: any) => agentTokens.push(payload));
    client.on('agent:done', (payload: any) => agentDones.push(payload));

    const messageCreatedPromise = new Promise<any>((resolve) => {
      client.once('message:created', (message: any) => {
        if (message.role === 'user') resolve(message);
      });
    });
    client.emit('user:message', { conversationId, content: 'Hello!' });
    const userMessage = await messageCreatedPromise;
    expect(userMessage.content).toBe('Hello!');

    await new Promise<void>((resolve) => {
      const check = () => (agentDones.length > 0 ? resolve() : setTimeout(check, 100));
      check();
    });
    await delay(100);

    expect(agentTokens.map((payload) => payload.token).join('')).toBe('First response from agent');
    const agentMessageId = agentDones[0].messageId;

    const agentTokens2: any[] = [];
    const agentDones2: any[] = [];
    client.on('agent:token', (payload: any) => agentTokens2.push(payload));
    client.on('agent:done', (payload: any) => agentDones2.push(payload));

    const deletedPromise = new Promise<any>((resolve) => client.once('message:deleted', resolve));
    client.emit('message:regenerate', agentMessageId);
    const deletedEvent = await deletedPromise;
    expect(deletedEvent).toMatchObject({ id: agentMessageId, conversationId });

    await new Promise<void>((resolve) => {
      const check = () => (agentDones2.length > 0 ? resolve() : setTimeout(check, 100));
      check();
    });
    await delay(100);

    expect(agentTokens2.map((payload) => payload.token).join('')).toBe('Second regenerated response');
    expect(agentDones2[0].messageId).not.toBe(agentMessageId);
  }, 15000);

  it('regenerate honors @mention targeting with multiple personas', async () => {
    const { port } = httpServer.address() as { port: number };
    client = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      multiplex: false,
      reconnection: false,
      auth: { token },
    });
    await new Promise<void>((resolve) => client.once('connect', resolve));

    // Two enabled personas — a bare message would make BOTH reply.
    const personaPromise = new Promise<void>((resolve) => {
      client.on('personas:list', (personas: any[]) => {
        if (personas.length >= 2) resolve();
      });
    });
    client.emit('persona:create', {
      name: 'TestBot',
      model: 'test-model:latest',
      systemPrompt: 'You are a test bot.',
      temperature: 0.7,
      enabled: true,
    });
    client.emit('persona:create', {
      name: 'OtherBot',
      model: 'test-model:latest',
      systemPrompt: 'You are another test bot.',
      temperature: 0.7,
      enabled: true,
    });
    await personaPromise;

    const convPromise = new Promise<any>((resolve) => client.once('conversation:created', resolve));
    client.emit('conversation:create', 'Mention Test');
    const conv = await convPromise;
    const conversationId = conv.id;

    await new Promise<void>((resolve) => {
      client.once('messages:history', () => resolve());
      client.emit('join', conversationId);
    });

    const dones: any[] = [];
    client.on('agent:done', (payload: any) => dones.push(payload));

    const messageCreatedPromise = new Promise<any>((resolve) => {
      client.once('message:created', (message: any) => {
        if (message.role === 'user') resolve(message);
      });
    });
    client.emit('user:message', { conversationId, content: '@TestBot Hello!' });
    const userMessage = await messageCreatedPromise;
    expect(userMessage.content).toBe('@TestBot Hello!');

    await new Promise<void>((resolve) => {
      const check = () => (dones.length > 0 ? resolve() : setTimeout(check, 100));
      check();
    });
    await delay(200);

    // Only TestBot answered — OtherBot must stay silent despite being enabled.
    expect(dones).toHaveLength(1);
    expect(dones[0].agentName).toBe('TestBot');
    const firstMessageId = dones[0].messageId;

    // Regenerate: the old message is replaced AND the mention is honored again
    // — OtherBot must NOT be triggered a second time.
    const deletedPromise = new Promise<any>((resolve) => client.once('message:deleted', resolve));
    client.emit('message:regenerate', firstMessageId);
    const deletedEvent = await deletedPromise;
    expect(deletedEvent).toMatchObject({ id: firstMessageId, conversationId });

    dones.length = 0;
    await new Promise<void>((resolve) => {
      const check = () => (dones.length > 0 ? resolve() : setTimeout(check, 100));
      check();
    });
    await delay(200);

    expect(dones).toHaveLength(1);
    expect(dones[0].agentName).toBe('TestBot');
    expect(dones[0].messageId).not.toBe(firstMessageId);
  }, 15000);

  it('rejects regenerate when socket.user is null', async () => {
    const { port } = httpServer.address() as { port: number };
    client = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      multiplex: false,
      reconnection: false,
    });
    await new Promise<void>((resolve) => client.once('connect', resolve));

    const errorPromise = new Promise<any>((resolve) => client.once('agent:error', resolve));
    client.emit('message:regenerate', 'any-message-id');
    const error = await errorPromise;
    expect(error.error).toBe('Authentication required');
  }, 10000);
});
