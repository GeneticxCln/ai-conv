import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { io as ioc } from 'socket.io-client';

vi.hoisted(() => {
  process.env.DATABASE_PATH = `/tmp/ai-conv-local-clients-${process.pid}.db`;
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-local-clients-secret-key-64-chars-long-for-hs256-hmac';
  // Mirrors docker-compose: a container port rewrites the host browser's
  // source address to a non-loopback bridge subnet that must count as local.
  process.env.LOCAL_CLIENT_CIDRS = '192.168.50.0/24';
});

import { setupSocketHandler } from './handler';
import { AgentRegistry } from '../agents/index.js';
import { db, getUsers } from '../storage/db.js';

interface Ack {
  ok?: boolean;
  error?: string;
  user?: { id: string; name: string };
  token?: string;
}

const TRUSTED_ADDRESS = '192.168.50.7';
const REMOTE_ADDRESS = '192.168.51.7';

let httpServer: ReturnType<typeof createServer>;
let io: Server;
const clients: Array<ReturnType<typeof ioc>> = [];

async function connect(address: string): Promise<{ client: ReturnType<typeof ioc>; serverSocket: Socket }> {
  const serverSocketPromise = new Promise<Socket>((resolve) => io.once('connection', resolve));
  const { port } = httpServer.address() as { port: number };
  const client = ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    multiplex: false,
    reconnection: false,
    auth: { simulateAddress: address },
  });
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });
  return { client, serverSocket: await serverSocketPromise };
}

function emitAck<T>(client: ReturnType<typeof ioc>, event: string, payload?: unknown): Promise<T> {
  return (payload === undefined ? client.emitWithAck(event) : client.emitWithAck(event, payload)) as Promise<T>;
}

beforeEach(() => {
  httpServer = createServer();
  io = new Server(httpServer, { transports: ['websocket'] });
  httpServer.listen(0);
  setupSocketHandler(io, new AgentRegistry(io));
  // Test-only middleware: rewrite the peer address BEFORE the connection
  // handler runs, so connection-time pushes see the simulated network.
  io.use((socket, next) => {
    const simulated = socket.handshake.auth?.simulateAddress;
    if (typeof simulated === 'string') socket.handshake.address = simulated;
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

describe('LOCAL_CLIENT_CIDRS', () => {
  it('treats an address inside the configured CIDR as local', async () => {
    const { client } = await connect(TRUSTED_ADDRESS);

    const created = await emitAck<Ack>(client, 'user:create', { name: 'Owner' });
    expect(created.ok).toBe(true);
    expect(created.token).toBeTruthy();

    const users = await emitAck<Array<{ name: string }>>(client, 'users:list');
    expect(Array.isArray(users)).toBe(true);
    expect(users.map((user) => user.name)).toContain('Owner');
  });

  it('keeps an address outside the configured CIDR remote', async () => {
    const { client } = await connect(REMOTE_ADDRESS);

    const created = await emitAck<Ack>(client, 'user:create', { name: 'Intruder' });

    expect(created.ok).toBe(false);
    expect(created.error).toBe('Authentication required to create a profile');
    expect(getUsers()).toHaveLength(0);

    const listing = await emitAck<Ack>(client, 'users:list:bootstrap');
    expect(listing.ok).toBe(false);
    expect(listing.error).toBe('Authentication required');
  });

  it('always treats loopback as local without configuration', async () => {
    const { client } = await connect('127.0.0.1');

    const created = await emitAck<Ack>(client, 'user:create', { name: 'Desktop' });

    expect(created.ok).toBe(true);
    expect(getUsers().map((user) => user.name)).toEqual(['Desktop']);
  });
});
