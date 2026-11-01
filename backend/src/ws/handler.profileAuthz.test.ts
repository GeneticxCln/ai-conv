import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { io as ioc } from 'socket.io-client';

vi.hoisted(() => {
  process.env.DATABASE_PATH = `/tmp/ai-conv-profile-authz-${process.pid}.db`;
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-profile-authz-secret-key-64-chars-long-for-hs256-hmac';
});

import { setupSocketHandler } from './handler';
import { AgentRegistry } from '../agents/index.js';
import { db, getUser } from '../storage/db.js';

interface Ack {
  ok?: boolean;
  error?: string;
  user?: { id: string; name: string };
  token?: string;
}

const REMOTE_ADDRESS = '192.168.50.7';

let httpServer: ReturnType<typeof createServer>;
let io: Server;
const clients: Array<ReturnType<typeof ioc>> = [];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createClient(token?: string, remote = false): ReturnType<typeof ioc> {
  const { port } = httpServer.address() as { port: number };
  const auth: Record<string, unknown> = {};
  if (token) auth.token = token;
  // Picked up by the test-only middleware below, which rewrites the peer
  // address BEFORE the connection handler runs. A post-connect mutation would
  // miss connection-time emissions.
  if (remote) auth.simulateRemote = true;

  const client = ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    multiplex: false,
    reconnection: false,
    auth: Object.keys(auth).length ? auth : undefined,
  });
  clients.push(client);
  return client;
}

async function connect(
  token?: string,
  options: { remote?: boolean } = {},
): Promise<{ client: ReturnType<typeof ioc>; serverSocket: Socket }> {
  const serverSocketPromise = new Promise<Socket>((resolve) => io.once('connection', resolve));
  const client = createClient(token, options.remote);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });
  return { client, serverSocket: await serverSocketPromise };
}

function emitAck<T>(client: ReturnType<typeof ioc>, event: string, payload?: unknown): Promise<T> {
  return (payload === undefined ? client.emitWithAck(event) : client.emitWithAck(event, payload)) as Promise<T>;
}

/** Create a profile over a throwaway loopback connection and keep its token. */
async function createProfile(name: string): Promise<{ id: string; token: string }> {
  const { client } = await connect();
  const result = await emitAck<Ack>(client, 'user:create', { name });
  expect(result.token, result.error).toBeTruthy();
  client.close();
  return { id: result.user!.id, token: result.token! };
}

beforeEach(() => {
  httpServer = createServer();
  io = new Server(httpServer, { transports: ['websocket'] });
  httpServer.listen(0);
  setupSocketHandler(io, new AgentRegistry(io));
  // Test-only middleware. setupSocketHandler's auth middleware runs first, so
  // by the time this runs the token is verified and the connection handler has
  // not fired yet.
  io.use((socket, next) => {
    if (socket.handshake.auth?.simulateRemote) {
      socket.handshake.address = REMOTE_ADDRESS;
    }
    next();
  });
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM personas; DELETE FROM users;');
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

describe('user:delete authorization', () => {
  it('rejects a remote client deleting another profile', async () => {
    const alice = await createProfile('Alice');
    const bob = await createProfile('Bob');

    const { client } = await connect(alice.token, { remote: true });

    const result = await emitAck<Ack>(client, 'user:delete', bob.id);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Only the active profile can be deleted remotely');
    expect(getUser(bob.id)).not.toBeNull();
  });

  it('allows a remote client to delete its own profile', async () => {
    const alice = await createProfile('Alice');
    const bob = await createProfile('Bob');

    const { client } = await connect(alice.token, { remote: true });

    const result = await emitAck<Ack>(client, 'user:delete', alice.id);

    expect(result.ok).toBe(true);
    expect(getUser(alice.id)).toBeNull();
    expect(getUser(bob.id)).not.toBeNull();
  });

  it('still lets a local client delete another profile from the lock screen', async () => {
    const alice = await createProfile('Alice');
    const bob = await createProfile('Bob');

    const { client } = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'user:delete', bob.id);

    expect(result.ok).toBe(true);
    expect(getUser(bob.id)).toBeNull();
  });

  it('rejects an unauthenticated remote client before any deletion', async () => {
    const bob = await createProfile('Bob');

    const { client } = await connect(undefined, { remote: true });

    const result = await emitAck<Ack>(client, 'user:delete', bob.id);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Authentication required');
    expect(getUser(bob.id)).not.toBeNull();
  });
});

describe('user:select authorization', () => {
  it('rejects a remote client selecting another profile', async () => {
    const alice = await createProfile('Alice');
    const bob = await createProfile('Bob');

    const { client } = await connect(alice.token, { remote: true });

    const result = await emitAck<Ack>(client, 'user:select', bob.id);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Only the active profile can be selected remotely');
    // No token may be minted for the other profile.
    expect(result.token).toBeUndefined();
  });

  it('allows a remote client to re-select its own profile', async () => {
    const alice = await createProfile('Alice');

    const { client } = await connect(alice.token, { remote: true });

    const result = await emitAck<Ack>(client, 'user:select', alice.id);

    expect(result.ok).toBe(true);
    expect(result.user?.id).toBe(alice.id);
    expect(result.token).toBeTruthy();
  });

  it('still lets a local client switch to another profile', async () => {
    const alice = await createProfile('Alice');
    const bob = await createProfile('Bob');

    const { client } = await connect(alice.token);

    const result = await emitAck<Ack>(client, 'user:select', bob.id);

    expect(result.ok).toBe(true);
    expect(result.user?.id).toBe(bob.id);
    expect(result.token).toBeTruthy();
  });

  it('keeps the anonymous loopback recovery path', async () => {
    const bob = await createProfile('Bob');

    const { client } = await connect();

    const result = await emitAck<Ack>(client, 'user:select', bob.id);

    expect(result.ok).toBe(true);
    expect(result.user?.id).toBe(bob.id);
    expect(result.token).toBeTruthy();
  });
});

describe('profile listing is local-only', () => {
  it('does not push the profile list to a remote client on connect', async () => {
    const alice = await createProfile('Alice');
    await createProfile('Bob');

    const client = createClient(alice.token, true);
    const received: unknown[] = [];
    client.on('users:list', (list: unknown) => received.push(list));
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });

    await delay(200);
    expect(received).toHaveLength(0);
  });

  it('pushes the profile list to a local client on connect', async () => {
    const alice = await createProfile('Alice');
    await createProfile('Bob');

    const client = createClient(alice.token, false);
    const received: unknown[] = [];
    client.on('users:list', (list: unknown) => received.push(list));
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });

    await delay(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(2);
  });

  it('rejects users:list from a remote client', async () => {
    const alice = await createProfile('Alice');
    await createProfile('Bob');

    const { client } = await connect(alice.token, { remote: true });

    const result = await emitAck<Ack>(client, 'users:list');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Profile listing is only available locally');
    // The ack must be an error object, never the profile array.
    expect(Array.isArray(result)).toBe(false);
  });

  it('rejects users:list:bootstrap from an authenticated remote client', async () => {
    const alice = await createProfile('Alice');
    await createProfile('Bob');

    const { client } = await connect(alice.token, { remote: true });

    const result = await emitAck<Ack>(client, 'users:list:bootstrap');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Profile listing is only available locally');
  });

  it('returns the profile list to a local client', async () => {
    const alice = await createProfile('Alice');
    await createProfile('Bob');

    const { client } = await connect(alice.token);

    const users = await emitAck<Array<{ name: string }>>(client, 'users:list');

    expect(Array.isArray(users)).toBe(true);
    expect(users.map((user) => user.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('keeps the anonymous loopback bootstrap path', async () => {
    const bob = await createProfile('Bob');

    const { client } = await connect();

    const users = await emitAck<Array<{ id: string }>>(client, 'users:list:bootstrap');

    expect(users.map((user) => user.id)).toContain(bob.id);
  });

  it('does not broadcast profile names to remote sockets after a deletion', async () => {
    const alice = await createProfile('Alice');
    const bob = await createProfile('Bob');

    const observer = await connect(alice.token, { remote: true });
    const actor = await connect(bob.token);
    const remoteEvents: unknown[] = [];
    const localEvents: unknown[] = [];
    observer.client.on('users:list', (list: unknown) => remoteEvents.push(list));
    actor.client.on('users:list', (list: unknown) => localEvents.push(list));

    const result = await emitAck<Ack>(actor.client, 'user:delete', bob.id);
    expect(result.ok).toBe(true);

    await delay(200);
    expect(remoteEvents).toHaveLength(0);
    expect(localEvents).toHaveLength(1);
  });
});
