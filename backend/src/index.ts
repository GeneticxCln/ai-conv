import Fastify from 'fastify';
import { fastifyCors } from '@fastify/cors';
import { fastifyStatic } from '@fastify/static';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { AgentRegistry, DefaultAgent, ToolEnabledDefaultAgent } from './agents/index.js';
import { setupSocketHandler } from './ws/handler';
import { checkOllamaHealth } from './llm/ollama';
import { HealthResponseSchema } from '@ai-conv/types';
import { getPersonas } from './storage/db';
import type Redis from 'ioredis';
import { connectRedis, disconnectRedis, getRedisClient } from './redis/client.js';
import path from 'path';
import { fileURLToPath } from 'url';

// ============ Config ============
const PORT = parseInt(process.env.PORT || '3001', 10);
// Single origin or comma-separated list (e.g. the Tauri desktop shell adds
// "http://localhost:3001,http://localhost:5173").
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Catch uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// ============ Setup ============
async function main() {
  const fastify = Fastify({ logger: true });

  // CORS
  await fastify.register(fastifyCors, {
    origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Serve the frontend build from the same server — single port, zero-config.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Electron supplies FRONTEND_DIST for packaged builds. In development,
  // resolve from backend/dist back to the repository frontend build.
  const frontendDist = process.env.FRONTEND_DIST
    ? path.resolve(process.env.FRONTEND_DIST)
    : path.resolve(__dirname, '../../frontend/dist');
  if (!path.isAbsolute(frontendDist)) {
    throw new Error(`Invalid frontend distribution path: ${frontendDist}`);
  }
  await fastify.register(fastifyStatic, {
    root: frontendDist,
    prefix: '/',
    // wildcard: true resolves files against the filesystem per request, so a
    // frontend rebuild (new hashed asset filenames) is picked up WITHOUT a
    // backend restart. wildcard: false snapshots the file map at startup and
    // new asset files fall through to the SPA fallback as text/html, which
    // breaks the page until the backend is restarted.
    wildcard: true,
  });
  // SPA fallback: serve index.html for any non-API, non-socket.io route
  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/socket.io/')) return;
    reply.sendFile('index.html');
  });

  // Socket.io shares Fastify's HTTP server.
  // We removed @fastify/websocket to prevent it from intercepting
  // WebSocket upgrades meant for socket.io.
  const wsOrigin = process.env.VITE_WS_URL || '';
  const corsOrigins = [...CORS_ORIGIN];
  if (wsOrigin && !corsOrigins.includes(wsOrigin)) corsOrigins.push(wsOrigin);
  const io = new Server(fastify.server, {
    cors: {
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  // --- Redis Adapter for multi-instance scaling ---
  const redisUrl = process.env.REDIS_URL;
  let redisSubInstance: Redis | null = null;
  if (redisUrl && redisUrl.length > 0) {
    try {
      const redisPub = await connectRedis();
      if (redisPub) {
        redisSubInstance = redisPub.duplicate();
        await redisSubInstance.connect();
        io.adapter(createAdapter(redisPub, redisSubInstance));
        console.log('[Socket.io] Redis adapter enabled — multi-instance scaling active');
      }
    } catch (err) {
      console.warn('[Socket.io] Redis unavailable, running in standalone mode:', err instanceof Error ? err.message : String(err));
    }
  }

  // Initialize agent registry
  const registry = new AgentRegistry(io);
  const personas = getPersonas();
  for (const p of personas) {
    const AgentClass = p.enabledTools ? ToolEnabledDefaultAgent : DefaultAgent;
    registry.register(
      { id: p.id, name: p.name, model: p.model, systemPrompt: p.systemPrompt, temperature: p.temperature, enabled: p.enabled, enabledTools: p.enabledTools ?? false, description: p.description, avatar: p.avatar, userId: p.userId },
      AgentClass
    );
    console.log(`Loaded persona: ${p.name} (${p.model})`);
  }

  // Setup Socket.io handlers
  setupSocketHandler(io, registry);

  // Health check
  fastify.get('/health', async () => {
    const ollamaHealthy = await checkOllamaHealth();
    let redisHealthy = false;
    try {
      const redis = getRedisClient();
      if (redis && redis.status === 'ready') {
        await redis.ping();
        redisHealthy = true;
      }
    } catch { /* ignore */ }
    return HealthResponseSchema.parse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      ollama: ollamaHealthy,
      redis: redisHealthy,
    });
  });

  // Start
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server listening on port ${PORT} (HTTP + WebSocket)`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await io.close();
    await fastify.close();
    if (redisSubInstance) {
      try { await redisSubInstance.quit(); } catch { /* ignore */ }
    }
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();