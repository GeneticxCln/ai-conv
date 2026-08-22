import { Server, Socket } from 'socket.io';
import { AgentRegistry, DefaultAgent } from '../agents';
import { createConversation, ensureConversation, getConversation, getMessages, getMessagePage, getConversations, updateConversationTimestamp, createMessage, createPersonaRow, updatePersonaRow, deletePersonaRow, renameConversation as dbRenameConversation, clearConversations as dbClearConversations, deleteConversation as dbDeleteConversation, createUser, getUsers, deleteUserRow, setParticipants, getParticipants, deleteMessageRow, getMessage } from '../storage/db';
import { UserMessagePayloadSchema } from '../types';
import { randomUUID } from 'crypto';
import { ollama, abortStreamsForConversation } from '../llm/ollama';

// Simple in-memory rate limiter for model:pull
const pullRateLimiter = new Map<string, number[]>();
const PULL_RATE_LIMIT_WINDOW = 60000; // 1 minute
const PULL_RATE_LIMIT_MAX = 3; // max 3 pulls per minute per socket

function checkPullRateLimit(socketId: string): boolean {
  const now = Date.now();
  const timestamps = pullRateLimiter.get(socketId) || [];
  const recent = timestamps.filter(ts => now - ts < PULL_RATE_LIMIT_WINDOW);
  if (recent.length >= PULL_RATE_LIMIT_MAX) return false;
  recent.push(now);
  pullRateLimiter.set(socketId, recent);
  return true;
}

 // ============ Socket Handler ============
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Join conversation room; history is served in bounded pages.
    socket.on('join', (conversationId: string) => {
      socket.join(conversationId);
      console.log(`Socket ${socket.id} joined conversation ${conversationId}`);
      socket.emit('messages:history', { conversationId, messages: getMessagePage(conversationId, 100) });
    });

    // Older messages, newest-first internally; client prepends the returned page.
    socket.on('messages:older', ({ conversationId, before }: { conversationId: string; before?: string }, ack?: (page: unknown) => void) => {
      const page = getMessagePage(String(conversationId), 100, before ? String(before) : undefined);
      if (typeof ack === 'function') ack(page); else socket.emit('messages:older', page);
    });

    socket.on('leave', (conversationId: string) => {
      socket.leave(conversationId);
    });

    // ===== Users (lightweight local profiles) =====
    socket.on('users:list', (ack?: (users: unknown[]) => void) => {
      const users = getUsers();
      if (typeof ack === 'function') ack(users); else socket.emit('users:list', users);
    });

    socket.on('user:create', ({ name, avatar }: { name: string; avatar?: string }, ack?: (u: unknown) => void) => {
      const user = createUser(String(name || 'User').trim() || 'User', avatar ? String(avatar).slice(0, 4) : undefined);
      io.emit('users:list', getUsers());
      if (typeof ack === 'function') ack(user);
    });

    socket.on('user:delete', (id: string) => {
      deleteUserRow(String(id));
      io.emit('users:list', getUsers());
    });

    // Per-conversation participants (empty/null = all enabled personas)
    socket.on('participants:set', ({ conversationId, personaIds }: { conversationId: string; personaIds: string[] }) => {
      setParticipants(String(conversationId), Array.isArray(personaIds) ? personaIds.map(String) : []);
      io.emit('conversation:list', getConversations());
    });

    // Handle user message
    socket.on('user:message', async (payload: unknown) => {
      const parsed = UserMessagePayloadSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('error', { message: 'Invalid payload', errors: parsed.error.format() });
        return;
      }

      const { conversationId, content, tempId } = parsed.data;

      try {
        // Ensure conversation exists with this exact id
        ensureConversation(conversationId);

        // Auto-title: first user message names the conversation
        const conv = getConversation(conversationId);
        if (conv && conv.title === 'New Conversation') {
          dbRenameConversation(conversationId, content.slice(0, 60));
          io.emit('conversation:list', getConversations());
        }

        // Save user message and echo it so every client (including the
        // sender) renders it immediately without a rejoin.
        // Preserve client's tempId for reliable dedupe.
        const userMessage = createMessage(conversationId, 'user', content, undefined, undefined, false, tempId);
        io.emit('message:user', userMessage);
        updateConversationTimestamp(conversationId);

        // Get history for context
        const history = getMessages(conversationId);

        // @mention targeting: "@Name message" replies only from that persona
        const mentionMatch = content.match(/^@([\w\s.-]{1,40}?)\s+/);
        let targets = registry.getEnabled();
        if (mentionMatch) {
          const wanted = mentionMatch[1].trim().toLowerCase();
          const matched = targets.filter(a => a.name.toLowerCase().includes(wanted));
          if (matched.length > 0) targets = matched;
        }

        // Per-conversation participant filter (empty = everyone)
        const participants = getParticipants(conversationId);
        if (!mentionMatch && participants && participants.length > 0) {
          targets = targets.filter(a => participants.includes(a.id));
        }

        // Trigger target agents in parallel
        const promises = targets.map(agent =>
          agent.handleUserMessage(conversationId, content, history).catch((err: Error) => {
            console.error(`Agent ${agent.name} error:`, err);
          })
        );

        // Agent-to-agent: one extra round where personas react to each other
        if (parsed.data.agentChat) {
          Promise.allSettled(promises).then(() => {
            const history2 = getMessages(conversationId);
            for (const agent of registry.getEnabled()) {
              agent.handleContinue(conversationId, history2).catch((err: Error) => {
                console.error(`Agent ${agent.name} continue error:`, err);
              });
            }
          });
        }
      } catch (error) {
        console.error('Error handling user message:', error);
        socket.emit('error', { message: 'Failed to process message' });
      }
    });

    // Stop all generations in a conversation
    socket.on('generation:stop', (conversationId: string) => {
      const n = abortStreamsForConversation(String(conversationId));
      console.log(`Stopped ${n} stream(s) in ${conversationId}`);
    });

    // ===== Message ops =====
    socket.on('message:delete', (id: string) => {
      const res = deleteMessageRow(String(id));
      if (res.ok && res.conversationId) {
        io.to(res.conversationId).emit('message:deleted', { conversationId: res.conversationId, id });
      }
    });

    // Regenerate the last agent reply for its persona
    socket.on('message:regenerate', async (id: string) => {
      const msg = getMessage(String(id));
      if (!msg || msg.role !== 'agent' || !msg.agentId) return;
      const history = getMessages(msg.conversationId);
      const idx = history.findIndex(m => m.id === msg.id);
      if (idx === -1 || idx !== history.length - 1) return; // only last message
      deleteMessageRow(msg.id);
      io.to(msg.conversationId).emit('message:deleted', { conversationId: msg.conversationId, id: msg.id });
      const agent = registry.get(msg.agentId);
      const historyBefore = getMessages(msg.conversationId);
      if (agent) {
        await agent.handleContinue(msg.conversationId, historyBefore).catch((err: Error) =>
          console.error(`Regenerate failed for ${agent.name}:`, err)
        );
      }
    });

    // ===== Import conversation (from exported JSON) =====
    socket.on('conversation:import', (data: { title?: string; messages?: Array<{ role: string; content: string; agentName?: string; createdAt?: string }> }, ack?: (c: unknown) => void) => {
      try {
        const conv = createConversation(String(data.title || 'Imported').slice(0, 120));
        for (const m of data.messages || []) {
          const role = m.role === 'user' ? 'user' : m.role === 'agent' ? 'agent' : 'system';
          createMessage(conv.id, role as 'user' | 'agent' | 'system', String(m.content || ''), undefined, m.agentName);
        }
        io.emit('conversation:list', getConversations());
        if (typeof ack === 'function') ack(conv);
      } catch (err) {
        console.error('conversation:import failed', err);
        if (typeof ack === 'function') ack(null);
      }
    });

    // ===== Persona management (user-created, stored in DB) =====
    const broadcastPersonas = () => {
      io.emit('personas:list', registry.getAllPersonas());
    };

    socket.on('personas:list', () => {
      socket.emit('personas:list', registry.getAllPersonas());
    });

    // ===== Installed Ollama models =====
    socket.on('models:list', async (ack?: (models: string[]) => void) => {
      try {
        const { models } = await ollama.list();
        const names = models.map(m => m.name);
        if (typeof ack === 'function') ack(names);
        else socket.emit('models:list', names);
      } catch (err) {
        console.error('models:list failed', err);
        if (typeof ack === 'function') ack([]);
      }
    });

    // ===== Pull a model (with progress broadcast) =====
    socket.on('model:pull', async (modelName: string) => {
      // Rate limit per socket
      if (!checkPullRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded: max 3 model pulls per minute' });
        return;
      }
      const name = String(modelName || '').trim();
      console.log(`Pulling model: ${name}`);
      try {
        const stream = await ollama.pull({ model: name, stream: true });
        for await (const progress of stream) {
          io.emit('model:pull:progress', {
            model: name,
            status: progress.status || 'downloading',
            percent: progress.total ? Math.round(((progress.completed || 0) / progress.total) * 100) : null,
          });
        }
        io.emit('model:pull:progress', { model: name, status: 'done', percent: 100 });
        console.log(`Model pulled: ${name}`);
      } catch (err) {
        console.error(`model:pull failed for ${name}`, err);
        io.emit('model:pull:progress', { model: name, status: 'error', percent: null });
      }
    });

    socket.on('persona:create', async (data: any) => {
      try {
        const id = randomUUID();
        let model = 'llama3.1:8b';
        if (typeof data.model === 'string' && data.model.trim()) {
          model = data.model.trim().slice(0, 120);
        } else {
          try {
            const { models } = await ollama.list();
            if (models.length > 0) model = models[0].name;
          } catch {
            // fall back to default model
          }
        }
        const row = createPersonaRow({
          id,
          name: String(data.name || 'Unnamed').slice(0, 60),
          model,
          systemPrompt: String(data.systemPrompt || 'You are a helpful assistant.').slice(0, 4000),
          temperature: Math.min(2, Math.max(0, Number(data.temperature ?? 0.7))),
          enabled: data.enabled !== false,
          description: data.description ? String(data.description).slice(0, 200) : undefined,
          avatar: data.avatar ? String(data.avatar).slice(0, 4) : undefined,
        });
        registry.register(
          { id: row.id, name: row.name, model: row.model, systemPrompt: row.systemPrompt, temperature: row.temperature, enabled: row.enabled, description: row.description, avatar: row.avatar },
          DefaultAgent
        );
        console.log(`Persona created: ${row.name}`);
        broadcastPersonas();
      } catch (err) {
        console.error('persona:create failed', err);
        socket.emit('error', { message: 'Failed to create persona' });
      }
    });

    socket.on('persona:update', ({ id, patch }: { id: string; patch: any }) => {
      const row = updatePersonaRow(id, patch);
      if (row) {
        registry.updatePersona(id, {
          name: row.name,
          model: row.model,
          systemPrompt: row.systemPrompt,
          temperature: row.temperature,
          enabled: row.enabled,
          description: row.description,
          avatar: row.avatar,
        });
        broadcastPersonas();
      }
    });

    socket.on('persona:delete', (id: string) => {
      if (deletePersonaRow(id)) {
        registry.unregister(id);
        broadcastPersonas();
      }
    });

    // Request conversations list
    socket.on('conversation:list', () => {
      socket.emit('conversation:list', getConversations());
    });

    socket.on('conversation:create', (title?: string) => {
      // Defensive: normalize title at handler level (defense in depth)
      const safeTitle = (title ?? '').trim().slice(0, 120) || 'New Conversation';
      const conversation = createConversation(safeTitle);
      socket.emit('conversation:created', conversation);
      io.emit('conversation:list', getConversations());
    });

    // Delete conversation
    socket.on('conversation:delete', (id: string) => {
      dbDeleteConversation(id);
      io.emit('conversation:list', getConversations());
      io.emit('conversation:deleted', id);
    });

    // Rename conversation
    socket.on('conversation:rename', ({ id, title }: { id: string; title: string }) => {
      if (dbRenameConversation(id, title)) {
        io.emit('conversation:list', getConversations());
      }
    });

    // Clear all conversations
    socket.on('conversations:clear', () => {
      dbClearConversations();
      io.emit('conversation:list', getConversations());
      io.emit('conversations:cleared');
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
