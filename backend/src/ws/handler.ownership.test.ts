import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';

vi.hoisted(() => {
  process.env.DATABASE_PATH = `/tmp/ai-conv-ownership-${process.pid}.db`;
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-ownership-secret-key-64-chars-long-for-hs256-hmac';
});

import { setupSocketHandler } from './handler';
import { AgentRegistry } from '../agents/index.js';
import { createUserWithToken } from '../auth.js';
import {
  db,
  createConversation,
  createMessage,
  createPersonaRow,
  getConversation,
  getMessage,
  getMessages,
} from '../storage/db.js';

interface Ack {
  ok?: boolean;
  error?: string;
}

let httpServer: ReturnType<typeof createServer>;
let io: Server;
const clients: Array<ReturnType<typeof ioc>> = [];

let alice: { id: string; token: string };
let bob: { id: string; token: string };
let aliceConversationId: string;
let bobConversationId: string;
let bobUserMessageId: string;
let bobAgentMessageId: string;

async function connect(token: string): Promise<ReturnType<typeof ioc>> {
  const { port } = httpServer.address() as { port: number };
  const client = ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    multiplex: false,
    reconnection: false,
    auth: { token },
  });
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });
  return client;
}

function emitAck<T>(client: ReturnType<typeof ioc>, event: string, payload?: unknown): Promise<T> {
  return (payload === undefined ? client.emitWithAck(event) : client.emitWithAck(event, payload)) as Promise<T>;
}

beforeEach(() => {
  httpServer = createServer();
  io = new Server(httpServer, { transports: ['websocket'] });
  httpServer.listen(0);
  setupSocketHandler(io, new AgentRegistry(io));
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM personas; DELETE FROM users;');

  const createdAlice = createUserWithToken('Alice');
  const createdBob = createUserWithToken('Bob');
  alice = { id: createdAlice.user.id, token: createdAlice.token };
  bob = { id: createdBob.user.id, token: createdBob.token };

  aliceConversationId = createConversation('Alice private', alice.id).id;
  bobConversationId = createConversation('Bob private', bob.id).id;
  bobUserMessageId = createMessage(bobConversationId, 'user', 'bob message').id;
  bobAgentMessageId = createMessage(bobConversationId, 'agent', 'bob reply', 'persona-bob', 'BobBot').id;
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    try { client.close(); } catch { /* ignore */ }
  }
  await new Promise<void>((resolve) => io.close(() => resolve()));
  if (httpServer.listening) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

describe('conversation events are scoped to the owning profile', () => {
  it('rejects joining another profile\'s conversation', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'join', bobConversationId);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Conversation not found');
  });

  it('rejects loading older messages from another profile\'s conversation', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'messages:older', { conversationId: bobConversationId });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Conversation not found');
  });

  it('rejects renaming another profile\'s conversation', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'conversation:rename', {
      id: bobConversationId,
      title: 'Hijacked',
    });

    expect(result.ok).toBe(false);
    expect(getConversation(bobConversationId)?.title).toBe('Bob private');
  });

  it('rejects deleting another profile\'s conversation', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'conversation:delete', bobConversationId);

    expect(result.ok).toBe(false);
    expect(getConversation(bobConversationId)).not.toBeNull();
  });

  it('rejects stopping generation in another profile\'s conversation', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'generation:stop', bobConversationId);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Conversation not found');
  });

  it('rejects setting participants on another profile\'s conversation', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'participants:set', {
      conversationId: bobConversationId,
      personaIds: [],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Conversation not found');
  });

  it('rejects participants that belong to another profile', async () => {
    const bobPersona = createPersonaRow({
      id: 'persona-bob',
      name: 'BobBot',
      model: 'test-model:latest',
      systemPrompt: 'Bob\'s persona',
      temperature: 0.7,
      enabled: true,
      enabledTools: false,
      userId: bob.id,
    }, bob.id);

    const client = await connect(alice.token);
    const result = await emitAck<Ack>(client, 'participants:set', {
      conversationId: aliceConversationId,
      personaIds: [bobPersona.id],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Participants must belong to the active profile');
  });

  it('clears only the caller\'s conversations', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'conversations:clear');

    expect(result.ok).toBe(true);
    expect(getConversation(aliceConversationId)).toBeNull();
    expect(getConversation(bobConversationId)).not.toBeNull();
  });

  it('still lets a profile delete its own conversation', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'conversation:delete', aliceConversationId);

    expect(result.ok).toBe(true);
    expect(getConversation(aliceConversationId)).toBeNull();
  });
});

describe('message events are scoped to the owning profile', () => {
  it('rejects deleting another profile\'s message', async () => {
    const client = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'message:delete', bobUserMessageId);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Message not found');
    expect(getMessage(bobUserMessageId)).not.toBeNull();
  });

  it('rejects regenerating another profile\'s message', async () => {
    const client = await connect(alice.token);
    const before = getMessages(bobConversationId).length;

    const result = await emitAck<Ack>(client, 'message:regenerate', bobAgentMessageId);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Message not found');
    expect(getMessage(bobAgentMessageId)).not.toBeNull();
    expect(getMessages(bobConversationId)).toHaveLength(before);
  });

  it('rejects posting a message into another profile\'s conversation', async () => {
    const client = await connect(alice.token);

    const error = await new Promise<{ error?: string }>((resolve) => {
      client.once('agent:error', resolve);
      client.emit('user:message', {
        conversationId: bobConversationId,
        content: 'injected message',
      });
    });

    expect(error.error).toBe('This conversation belongs to another user');
    const contents = getMessages(bobConversationId).map((message) => message.content);
    expect(contents).not.toContain('injected message');
  });

  it('still lets a profile delete its own message', async () => {
    const client = await connect(alice.token);
    const ownMessage = createMessage(aliceConversationId, 'user', 'delete me');

    const result = await emitAck<Ack>(client, 'message:delete', ownMessage.id);

    expect(result.ok).toBe(true);
    expect(getMessage(ownMessage.id)).toBeNull();
  });
});
