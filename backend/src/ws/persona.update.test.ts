import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';

vi.hoisted(() => {
  process.env.DATABASE_PATH = `/tmp/ai-conv-persona-update-${process.pid}.db`;
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-persona-update-secret-key-64-chars-long-for-hs256-hmac';
});

vi.mock('../llm/ollama.js', () => ({
  ollama: {
    list: vi.fn().mockResolvedValue({ models: [{ name: 'test-model:latest' }] }),
    pull: vi.fn(),
  },
  validateModel: vi.fn().mockResolvedValue({ valid: true, availableModels: ['test-model:latest'] }),
  streamChat: vi.fn(),
  abortStreamsForConversation: vi.fn(),
}));

import { setupSocketHandler } from './handler';
import { AgentRegistry } from '../agents/index.js';
import { db, getPersona } from '../storage/db.js';

interface Ack {
  ok?: boolean;
  error?: string;
  user?: { id: string; name: string };
  token?: string;
  persona?: { id: string };
}

let httpServer: ReturnType<typeof createServer>;
let io: Server;
const clients: Array<ReturnType<typeof ioc>> = [];
let client: ReturnType<typeof ioc>;
let userId: string;
let personaId: string;

async function connect(): Promise<ReturnType<typeof ioc>> {
  const { port } = httpServer.address() as { port: number };
  const socket = ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    multiplex: false,
    reconnection: false,
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

function emitAck<T>(socket: ReturnType<typeof ioc>, event: string, payload?: unknown): Promise<T> {
  return (payload === undefined ? socket.emitWithAck(event) : socket.emitWithAck(event, payload)) as Promise<T>;
}

const stored = () => getPersona(personaId, userId)!;

beforeEach(async () => {
  httpServer = createServer();
  io = new Server(httpServer, { transports: ['websocket'] });
  httpServer.listen(0);
  setupSocketHandler(io, new AgentRegistry(io));
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM personas; DELETE FROM users;');

  client = await connect();
  const created = await emitAck<Ack>(client, 'user:create', { name: 'PersonaTester' });
  expect(created.token, created.error).toBeTruthy();
  userId = created.user!.id;

  const persona = await emitAck<Ack>(client, 'persona:create', {
    name: 'TestBot',
    model: 'test-model:latest',
    systemPrompt: 'You are a test bot.',
    temperature: 0.7,
    enabled: true,
  });
  expect(persona.ok, persona.error).toBe(true);
  personaId = persona.persona!.id;
});

afterEach(async () => {
  for (const socket of clients.splice(0)) {
    try { socket.close(); } catch { /* ignore */ }
  }
  await new Promise<void>((resolve) => io.close(() => resolve()));
  if (httpServer.listening) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

describe('persona:update field validation', () => {
  it('clamps temperature to the create limit', async () => {
    const result = await emitAck<Ack>(client, 'persona:update', {
      id: personaId,
      patch: { temperature: 9 },
    });

    expect(result.ok, result.error).toBe(true);
    expect(stored().temperature).toBe(2);
  });

  it('rejects a non-numeric temperature instead of persisting NaN', async () => {
    const result = await emitAck<Ack>(client, 'persona:update', {
      id: personaId,
      patch: { temperature: 'hot' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Temperature/i);
    expect(stored().temperature).toBe(0.7);
  });

  it('truncates an oversized name and system prompt', async () => {
    const result = await emitAck<Ack>(client, 'persona:update', {
      id: personaId,
      patch: { name: 'n'.repeat(100), systemPrompt: 'p'.repeat(5000) },
    });

    expect(result.ok, result.error).toBe(true);
    expect(stored().name).toHaveLength(60);
    expect(stored().systemPrompt).toHaveLength(4000);
  });

  it('rejects blank required text instead of writing empty strings', async () => {
    const blankName = await emitAck<Ack>(client, 'persona:update', {
      id: personaId,
      patch: { name: '   ' },
    });
    expect(blankName.ok).toBe(false);
    expect(blankName.error).toBe('Persona name is required');

    const blankPrompt = await emitAck<Ack>(client, 'persona:update', {
      id: personaId,
      patch: { systemPrompt: '' },
    });
    expect(blankPrompt.ok).toBe(false);
    expect(blankPrompt.error).toBe('System prompt is required');

    expect(stored().name).toBe('TestBot');
    expect(stored().systemPrompt).toBe('You are a test bot.');
  });

  it('ignores ownership fields and survives non-object payloads', async () => {
    const result = await emitAck<Ack>(client, 'persona:update', {
      id: personaId,
      patch: { userId: 'someone-else', id: 'other-id', temperature: 0.3 },
    });

    expect(result.ok, result.error).toBe(true);
    expect(stored().id).toBe(personaId);
    expect(stored().userId).toBe(userId);
    expect(stored().temperature).toBe(0.3);

    const nullPayload = await emitAck<Ack>(client, 'persona:update', null);
    expect(nullPayload.ok).toBe(false);
    expect(nullPayload.error).toBe('Persona not found');
  });
});
