import Fastify from 'fastify';
import { fastifyCors } from '@fastify/cors';
import { fastifyWebsocket } from '@fastify/websocket';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { AgentRegistry, DefaultAgent } from './agents';
import { setupSocketHandler } from './ws/handler';
import { checkOllamaHealth } from './llm/ollama';
import { HealthResponseSchema } from './types';
import { getPersonas } from './storage/db';

// ============ Config ============
const PORT = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// ============ Fastify Setup ============
async function main() {
  const fastify = Fastify({ logger: true });

  // CORS
  await fastify.register(fastifyCors, {
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // WebSocket support
  await fastify.register(fastifyWebsocket);

  // HTTP Server for Socket.io
  const httpServer = createServer();

  // Socket.io with CORS
  const io = new Server(httpServer, {
    cors: {
      origin: CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  // Initialize agent registry — personas come from the DB (user-created)
  const registry = new AgentRegistry(io);
  const personas = getPersonas();
  for (const p of personas) {
    registry.register(
      { id: p.id, name: p.name, model: p.model, systemPrompt: p.systemPrompt, temperature: p.temperature, enabled: p.enabled, description: p.description, avatar: p.avatar },
      DefaultAgent
    );
    console.log(`Loaded persona: ${p.name} (${p.model})`);
  }

  // Setup Socket.io handlers
  setupSocketHandler(io, registry);

  // Health check endpoint
  fastify.get('/health', async () => {
    const ollamaHealthy = await checkOllamaHealth();
    return HealthResponseSchema.parse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      ollama: ollamaHealthy,
    });
  });

  // Start servers
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    httpServer.listen(PORT + 1, '0.0.0.0', () => {
      console.log(`Socket.io server listening on port ${PORT + 1}`);
    });
    console.log(`HTTP server listening on port ${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await io.close();
    await fastify.close();
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
