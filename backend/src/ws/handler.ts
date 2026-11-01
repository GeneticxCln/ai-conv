import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import {
  AgentRegistry,
  DefaultAgent,
  ToolEnabledDefaultAgent,
} from '../agents/index.js';
import {
  createConversation,
  ensureConversation,
  getConversation,
  getMessages,
  getMessagePage,
  getConversations,
  updateConversationTimestamp,
  createMessage,
  createPersonaRow,
  updatePersonaRow,
  deletePersonaRow,
  renameConversation as dbRenameConversation,
  clearConversations as dbClearConversations,
  deleteConversation as dbDeleteConversation,
  getUsers,
  getUser,
  deleteUserRow,
  setParticipants,
  getParticipants,
  deleteMessageRow,
  getMessage,
  exportAllData,
  importAllData,
  regenerateMessage,
  getPersonas,
  UserRow,
} from '../storage/db.js';
import { ConversationImportSchema, UserMessagePayloadSchema } from '@ai-conv/types';
import type { Persona } from '@ai-conv/types';
import { ollama, abortStreamsForConversation, validateModel } from '../llm/ollama.js';
import { getGpuInfo } from '../llm/gpuInfo.js';
import { createToken, createUserWithToken, getUserFromToken, verifyToken } from '../auth.js';
import {
  checkPullRateLimit,
  cleanupRateLimit,
  checkMessageRateLimit,
  checkCreateRateLimit,
} from '../redis/rateLimiter.js';

type Ack<T = any> = (value: T) => void;
type SocketUser = UserRow;

declare module 'socket.io' {
  interface Socket {
    user?: SocketUser;
  }
}

/**
 * A loopback client is the desktop app's own bridge (or a browser on the
 * same machine). Only loopback connections may bootstrap/recover local
 * profiles anonymously — remote clients must always authenticate, so a
 * stale token can never lock the desktop user out of their own data.
 */
function isLoopbackClient(socket: Socket): boolean {
  const address = socket.handshake.address || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

const userRoom = (userId: string) => `user:${userId}`;

function publicUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    createdAt: user.created_at,
  };
}

function emitAuthError(socket: Socket, ack?: Ack, error = 'Authentication required'): null {
  ack?.({ ok: false, error });
  const event = error === 'Authentication required' ? 'auth:error' : 'authorization:error';
  socket.emit(event, { error });
  if (error === 'Authentication required') {
    socket.emit('agent:error', { conversationId: '', agentId: '', agentName: 'System', error });
  }
  return null;
}

function requireUser(socket: Socket, ack?: Ack): SocketUser | null {
  return socket.user || emitAuthError(socket, ack);
}

function emitConversationList(io: Server, userId: string) {
  io.to(userRoom(userId)).emit('conversation:list', getConversations(userId));
}

/**
 * Push the profile list only to loopback sockets. Profile names are a local
 * surface: a remote (LAN) client must never receive the list of profiles on
 * this machine, whether in response to a request or as a broadcast after a
 * profile is created/deleted.
 */
function emitUsersListToLoopback(io: Server) {
  const users = getUsers().map(publicUser);
  for (const [, socket] of io.of('/').sockets) {
    if (isLoopbackClient(socket)) socket.emit('users:list', users);
  }
}

function syncUserPersonas(registry: AgentRegistry, userId: string): void {
  for (const persona of getPersonas(userId)) {
    const existing = registry.getPersona(persona.id, userId);
    const AgentClass = persona.enabledTools ? ToolEnabledDefaultAgent : DefaultAgent;
    if (!existing) {
      registry.register(persona, AgentClass);
    } else {
      registry.updatePersona(persona.id, userId, persona);
    }
  }
}

const PERSONA_LIMITS = {
  name: 60,
  systemPrompt: 4000,
  model: 120,
  description: 200,
  avatar: 4,
} as const;

const PERSONA_MAX_TEMPERATURE = 2;

/**
 * Trim and bound persona fields. persona:create and persona:update BOTH go
 * through this so an update can never store values create would reject
 * (out-of-range temperature, oversized name/prompt, blank required text).
 * Only keys present on the input are returned, so updates stay partial.
 */
function sanitizePersonaFields(input: unknown): { fields: Partial<Persona>; error?: string } {
  const fields: Partial<Persona> = {};
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) return { fields, error: 'Persona name is required' };
    fields.name = name.slice(0, PERSONA_LIMITS.name);
  }

  if (data.systemPrompt !== undefined) {
    const systemPrompt = String(data.systemPrompt).trim();
    if (!systemPrompt) return { fields, error: 'System prompt is required' };
    fields.systemPrompt = systemPrompt.slice(0, PERSONA_LIMITS.systemPrompt);
  }

  if (data.model !== undefined) {
    const model = String(data.model).trim();
    // An empty model means "not chosen yet": create auto-detects the first
    // installed model and update leaves the existing one untouched.
    if (model) fields.model = model.slice(0, PERSONA_LIMITS.model);
  }

  if (data.temperature !== undefined) {
    const temperature = typeof data.temperature === 'number' ? data.temperature : Number(data.temperature);
    if (!Number.isFinite(temperature)) {
      return { fields, error: 'Temperature must be a number between 0 and 2' };
    }
    fields.temperature = Math.min(PERSONA_MAX_TEMPERATURE, Math.max(0, temperature));
  }

  if (data.enabled !== undefined) fields.enabled = data.enabled !== false;
  if (data.enabledTools !== undefined) fields.enabledTools = data.enabledTools === true;

  if (data.description !== undefined) {
    fields.description = data.description == null
      ? undefined
      : String(data.description).slice(0, PERSONA_LIMITS.description);
  }

  if (data.avatar !== undefined) {
    fields.avatar = data.avatar == null
      ? undefined
      : String(data.avatar).slice(0, PERSONA_LIMITS.avatar);
  }

  return { fields };
}

export function setupSocketHandler(io: Server, registry: AgentRegistry) {
  // Bootstrap connections may create their first local profile. Every other
  // event is guarded below, and authenticated connections are bound here.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next();

    const payload = verifyToken(String(token));
    if (!payload) return next(new Error('Invalid token'));
    const user = getUserFromToken(String(token));
    if (!user) return next(new Error('User not found'));

    socket.user = user;
    socket.data.authToken = String(token);
    next();
  });

  io.on('connection', (socket: Socket) => {
    if (socket.user) {
      socket.join(userRoom(socket.user.id));
      syncUserPersonas(registry, socket.user.id);
      socket.emit('user:current', publicUser(socket.user));
      // Local-only surface: remote clients get their own identity via
      // user:current and must not learn the other profile names.
      if (isLoopbackClient(socket)) socket.emit('users:list', getUsers().map(publicUser));
      socket.emit('personas:list', registry.getAllPersonas(socket.user.id));
      socket.emit('conversation:list', getConversations(socket.user.id));
    }
    console.log(`Client connected: ${socket.id}`);

    socket.on('join', (conversationId: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const id = String(conversationId);
      if (!getConversation(id, user.id)) {
        emitAuthError(socket, ack, 'Conversation not found');
        return;
      }
      socket.join(id);
      const page = getMessagePage(id, user.id, 100);
      socket.emit('messages:history', { conversationId: id, ...page });
      ack?.({ ok: true, ...page });
    });

    socket.on('messages:older',
      (
        payload: { conversationId: string; before?: string },
        ack?: Ack,
      ) => {
        const user = requireUser(socket, ack);
        if (!user) return;
        const conversationId = String(payload?.conversationId || '');
        if (!getConversation(conversationId, user.id)) {
          emitAuthError(socket, ack, 'Conversation not found');
          return;
        }
        const page = getMessagePage(
          conversationId,
          user.id,
          100,
          payload?.before ? String(payload.before) : undefined,
        );
        socket.emit('messages:older', { conversationId, ...page });
        ack?.({ ok: true, conversationId, ...page });
      },
    );

    socket.on('leave', (conversationId: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      if (!getConversation(String(conversationId), user.id)) {
        emitAuthError(socket, ack, 'Conversation not found');
        return;
      }
      socket.leave(String(conversationId));
      ack?.({ ok: true });
    });

    socket.on('session:current', (ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const current = publicUser(user);
      socket.emit('user:current', current);
      ack?.(current);
    });

    socket.on('users:list', (ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      if (!isLoopbackClient(socket)) {
        emitAuthError(socket, ack, 'Profile listing is only available locally');
        return;
      }
      ack?.(getUsers().map(publicUser));
    });

    // Recovery path: a loopback client whose stored token went stale must be
    // able to see the existing profiles so it can select one and get a fresh
    // token. Remote clients are REJECTED here — leaking profile names to the
    // whole LAN would be a real vulnerability, not a convenience.
    socket.on('users:list:bootstrap', (ack?: Ack) => {
      // Same local-only rule as users:list. Anonymous loopback callers keep the
      // recovery path; authenticated remote callers are rejected too.
      if (!isLoopbackClient(socket)) {
        emitAuthError(
          socket,
          ack,
          socket.user ? 'Profile listing is only available locally' : 'Authentication required',
        );
        return;
      }
      // publicUser strips everything except id/name/avatar/createdAt.
      ack?.(getUsers().map(publicUser));
    });

    socket.on(
      'user:create',
      async (
        data: { name?: string; avatar?: string },
        ack?: Ack,
      ) => {
        // Anonymous profile creation is a one-time bootstrap operation.
        // Once a profile exists, callers must already hold a valid token —
        // EXCEPT loopback clients (the desktop app's own bridge), which may
        // recover access when their stored token went stale (e.g. the JWT
        // secret was regenerated). Remote clients stay locked down.
        if (!socket.user && getUsers().length > 0 && !isLoopbackClient(socket)) {
          emitAuthError(socket, ack, 'Authentication required to create another profile');
          return;
        }
        if (!(await checkCreateRateLimit(socket.id))) {
          ack?.({ ok: false, error: 'Rate limit exceeded' });
          return;
        }

        const { user, token } = createUserWithToken(
          String(data?.name || 'User').trim() || 'User',
          data?.avatar ? String(data.avatar).slice(0, 4) : undefined,
        );
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }
        socket.user = user;
        socket.data.authToken = token;
        socket.join(userRoom(user.id));
        syncUserPersonas(registry, user.id);
        socket.emit('user:current', publicUser(user));
        if (isLoopbackClient(socket)) socket.emit('users:list', getUsers().map(publicUser));
        socket.emit('personas:list', registry.getAllPersonas(user.id));
        socket.emit('conversation:list', getConversations(user.id));
        ack?.({ ok: true, user: publicUser(user), token });
      },
    );

    // Local profile switching is explicit: the server issues a fresh token
    // for the selected profile and immediately binds the socket to that user.
    // Loopback clients may switch profiles WITHOUT an existing token — that is
    // the recovery path when a stored token went stale (regenerated JWT
    // secret, expired token). Remote clients must authenticate first.
    socket.on('user:select', (id: string, ack?: Ack) => {
      const isLoopback = isLoopbackClient(socket);
      if (!socket.user && !isLoopback) {
        emitAuthError(socket, ack);
        return;
      }
      const targetId = String(id ?? '');
      // user:select mints a fresh token, so switching profiles is a LOCAL
      // operation (the lock screen's profile picker). A remote token holder
      // may only re-select the profile it is already bound to; anything else
      // would hand over another profile's conversations and personas.
      if (!isLoopback && socket.user && targetId !== socket.user.id) {
        emitAuthError(socket, ack, 'Only the active profile can be selected remotely');
        return;
      }
      const selected = getUser(targetId);
      if (!selected) {
        emitAuthError(socket, ack, 'User not found');
        return;
      }

      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room);
      }
      socket.user = selected;
      const token = createToken({ userId: selected.id, username: selected.name });
      socket.data.authToken = token;
      socket.join(userRoom(selected.id));
      syncUserPersonas(registry, selected.id);
      socket.emit('user:current', publicUser(selected));
      if (isLoopbackClient(socket)) socket.emit('users:list', getUsers().map(publicUser));
      socket.emit('personas:list', registry.getAllPersonas(selected.id));
      socket.emit('conversation:list', getConversations(selected.id));
      ack?.({ ok: true, user: publicUser(selected), token });
    });

    socket.on('user:delete', (id: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const targetId = String(id ?? '');
      // Profile management is a LOCAL operation: the lock screen lists every
      // local profile and may delete any of them. A remote client may only
      // delete the profile it is authenticated as — otherwise any token
      // holder on the network could wipe another profile's conversations and
      // personas. Checked before the lookup so remote callers cannot probe
      // which profile ids exist.
      if (targetId !== user.id && !isLoopbackClient(socket)) {
        emitAuthError(socket, ack, 'Only the active profile can be deleted remotely');
        return;
      }
      const targetUser = getUser(targetId);
      if (!targetUser) {
        ack?.({ ok: false, error: 'User not found' });
        return;
      }
      // Unregister all personas belonging to this user from in-memory registry
      const userPersonas = getPersonas(targetId);
      for (const p of userPersonas) {
        registry.unregister(p.id);
      }
      const deleted = deleteUserRow(targetId);
      if (deleted && targetId === user.id) {
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }
        socket.user = undefined;
        socket.data.authToken = undefined;
      }
      emitUsersListToLoopback(io);
      ack?.({ ok: deleted });
    });

    socket.on(
      'participants:set',
      ({ conversationId, personaIds }: { conversationId: string; personaIds: string[] }, ack?: Ack) => {
        const user = requireUser(socket, ack);
        if (!user) return;
        if (!getConversation(String(conversationId), user.id)) {
          emitAuthError(socket, ack, 'Conversation not found');
          return;
        }
        const requestedParticipants = Array.isArray(personaIds) ? personaIds.map(String) : [];
        const ownedPersonaIds = new Set(getPersonas(user.id).map((persona) => persona.id));
        if (requestedParticipants.some((personaId) => !ownedPersonaIds.has(personaId))) {
          ack?.({ ok: false, error: 'Participants must belong to the active profile' });
          return;
        }
        const ok = setParticipants(String(conversationId), user.id, requestedParticipants);
        ack?.({ ok });
      },
    );

    socket.on('user:message', async (payload: unknown) => {
      try {
        const user = requireUser(socket);
        if (!user) return;
        const parsed = UserMessagePayloadSchema.safeParse(payload);
        if (!parsed.success) {
          socket.emit('validation:error', { error: 'Invalid payload' });
          return;
        }

        const { conversationId, content, agentChat } = parsed.data;
        if (!(await checkMessageRateLimit(conversationId))) {
          socket.emit('agent:error', {
            conversationId,
            agentId: '',
            agentName: 'System',
            error: 'Rate limit exceeded — please wait before sending another message',
          });
          return;
        }

        const conversation = ensureConversation(conversationId, user.id);
        if (!conversation) {
          socket.emit('agent:error', {
            conversationId,
            agentId: '',
            agentName: 'System',
            error: 'This conversation belongs to another user',
          });
          return;
        }
        socket.join(conversationId);

        const history = getMessages(conversationId, user.id);
        if (conversation.title === 'New Conversation') {
          dbRenameConversation(conversationId, user.id, content.slice(0, 60));
        }
        updateConversationTimestamp(conversationId, user.id);

        const userMessage = createMessage(
          conversationId,
          'user',
          content,
          undefined,
          undefined,
          false,
          parsed.data.tempId,
        );
        io.to(conversationId).emit('message:created', userMessage);
        emitConversationList(io, user.id);

        let targetAgents = registry.getEnabled(user.id);
        const participants = getParticipants(conversationId, user.id);
        if (participants?.length) {
          targetAgents = targetAgents.filter((agent) => participants.includes(agent.id));
        }

        let agentContent = content;
        const trimmed = content.trim();
        if (trimmed.startsWith('@')) {
          // Sort persona names by length descending to match multi-word names first
          const sortedAgents = [...targetAgents].sort((a, b) => b.name.length - a.name.length);
          for (const candidate of sortedAgents) {
            const prefix = `@${candidate.name}`;
            if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
              const rest = trimmed.slice(prefix.length).trim();
              if (rest.length > 0) {
                targetAgents = [candidate];
                agentContent = rest;
                break;
              }
            }
          }
        }

        if (targetAgents.length === 0) {
          socket.emit('agent:error', {
            conversationId,
            agentId: '',
            agentName: 'System',
            error: 'No enabled personas',
          });
          return;
        }

        const generations = targetAgents.map((agent) =>
          agent.handleUserMessage(conversationId, agentContent, history).catch((error: unknown) => {
            console.error(`Agent ${agent.name} error:`, error);
          }),
        );

        if (agentChat) {
          void Promise.allSettled(generations).then(() => {
            const continuationHistory = getMessages(conversationId, user.id);
            let contAgents = registry.getEnabled(user.id);
            const currentParticipants = getParticipants(conversationId, user.id);
            if (currentParticipants?.length) {
              contAgents = contAgents.filter((agent) => currentParticipants.includes(agent.id));
            }
            for (const agent of contAgents) {
              void agent.handleContinue(conversationId, continuationHistory).catch((error: unknown) => {
                console.error(`Agent ${agent.name} continuation error:`, error);
              });
            }
          });
        }
      } catch (err) {
        let convId = '';
        if (payload && typeof payload === 'object' && 'conversationId' in payload) {
          const candidate = (payload as Record<string, unknown>).conversationId;
          if (typeof candidate === 'string') convId = candidate;
        }
        socket.emit('agent:error', {
          conversationId: convId,
          agentId: '',
          agentName: 'System',
          error: err instanceof Error ? err.message : 'Internal error processing message',
        });
      }
    });

    socket.on('generation:stop', (conversationId: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      if (!getConversation(String(conversationId), user.id)) {
        emitAuthError(socket, ack, 'Conversation not found');
        return;
      }
      abortStreamsForConversation(String(conversationId));
      io.to(String(conversationId)).emit('generation:stopped', String(conversationId));
      ack?.({ ok: true });
    });

    socket.on('message:regenerate', async (messageId: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const targetMessage = getMessage(String(messageId), user.id);
      if (!targetMessage?.conversationId) {
        ack?.({ ok: false, error: 'Message not found' });
        return;
      }

      const now = Date.now();
      const lastRegen = socket.data.lastRegenAt as number | undefined;
      if (lastRegen && now - lastRegen < 3000) {
        ack?.({ ok: false, error: 'Please wait before regenerating again' });
        return;
      }
      socket.data.lastRegenAt = now;

      const conversationId = targetMessage.conversationId;
      abortStreamsForConversation(conversationId);
      const result = regenerateMessage(String(messageId), user.id);
      if (!result.ok || !result.conversationId || !result.userMessageContent) {
        ack?.({ ok: false, error: 'Cannot regenerate this message' });
        return;
      }

      socket.join(conversationId);
      // Emit deletion for all messages removed by regeneration
      for (const deletedId of result.deletedMessageIds ?? [messageId]) {
        io.to(conversationId).emit('message:deleted', { conversationId, id: deletedId });
      }
      const history = getMessages(conversationId, user.id);
      updateConversationTimestamp(conversationId, user.id);
      let agents = registry.getEnabled(user.id);
      const participants = getParticipants(conversationId, user.id);
      if (participants?.length) agents = agents.filter((agent) => participants.includes(agent.id));

      // If regenerating a specific agent message, only re-run that specific agent
      if (result.agentId) {
        const specificAgent = agents.find((a) => a.id === result.agentId);
        if (specificAgent) {
          agents = [specificAgent];
        }
      }

      let agentContent = result.userMessageContent ?? '';
      const trimmed = agentContent.trim();
      if (trimmed.startsWith('@')) {
        const sortedAgents = [...agents].sort((a, b) => b.name.length - a.name.length);
        for (const candidate of sortedAgents) {
          const prefix = `@${candidate.name}`;
          if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
            const rest = trimmed.slice(prefix.length).trim();
            if (rest.length > 0) {
              agents = [candidate];
              agentContent = rest;
              break;
            }
          }
        }
      }

      for (const agent of agents) {
        void agent.handleUserMessage(conversationId, agentContent, history);
      }
      ack?.({ ok: true });
    });

    // Model listing is a read-only query about the local Ollama install.
    // Authenticated users AND loopback clients (the desktop shell's own
    // webview, anonymous during first-launch/profile-pick) may list models —
    // remote clients still cannot.
    socket.on('models:list', async (ack?: Ack<string[]>) => {
      if (!socket.user && !isLoopbackClient(socket)) {
        requireUser(socket, ack);
        return;
      }
      try {
        const { models } = await ollama.list();
        ack?.(models.map((model) => model.name));
      } catch {
        ack?.([]);
      }
    });

    // Full model metadata (name + size + parameter size). Used by the E2E
    // global-setup to pick the fastest installed chat model; the app UI only
    // needs names, so this stays a separate event to avoid changing
    // models:list's string[] contract.
    socket.on(
      'models:list:full',
      async (ack?: Ack<Array<{ name: string; size: number; parameterSize?: string; capabilities?: string[] }>>) => {
        if (!socket.user && !isLoopbackClient(socket)) {
          requireUser(socket, ack);
          return;
        }
        try {
          const { models } = await ollama.list();
          ack?.(models.map((model) => ({
            name: model.name,
            size: model.size,
            parameterSize: (model.details as { parameter_size?: string } | undefined)?.parameter_size,
            capabilities: (model as { capabilities?: string[] }).capabilities,
          })));
        } catch {
          ack?.([]);
        }
      },
    );

    // GPU memory report so the UI can warn when a persona's model is larger
    // than VRAM (partial CPU offload → extremely slow responses). Best-effort:
    // acks { available: false } on machines without nvidia-smi.
    socket.on('system:gpu', async (ack?: Ack) => {
      if (!requireUser(socket, ack)) return;
      try {
        ack?.(await getGpuInfo());
      } catch {
        ack?.({ available: false });
      }
    });

    socket.on('model:pull', (modelName: string, ack?: Ack) => {
      if (!requireUser(socket, ack)) return;
      checkPullRateLimit(socket.id, modelName).then((allowed) => {
        if (!allowed) {
          socket.emit('model:pull:progress', { model: modelName, status: 'rate_limited', percent: null });
          return;
        }
        void pullModel(socket, modelName);
      });
    });

    async function pullModel(currentSocket: Socket, modelName: string) {
      try {
        currentSocket.emit('model:pull:progress', { model: modelName, status: 'pulling', percent: 0 });
        const stream = await ollama.pull({ model: modelName, stream: true });
        for await (const chunk of stream) {
          if (chunk.status === 'pulling' && chunk.completed && chunk.total) {
            currentSocket.emit('model:pull:progress', {
              model: modelName,
              status: 'pulling',
              percent: Math.round((chunk.completed / chunk.total) * 100),
            });
          } else if (chunk.status === 'success') {
            currentSocket.emit('model:pull:progress', { model: modelName, status: 'done', percent: 100 });
          }
        }
      } catch (error) {
        currentSocket.emit('model:pull:progress', { model: modelName, status: 'error', percent: null });
        console.error('Model pull failed:', error);
      }
    }

    socket.on('persona:create', async (data: any, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      try {
        if (!(await checkCreateRateLimit(socket.id))) {
          ack?.({ ok: false, error: 'Rate limit exceeded' });
          return;
        }
        const { fields, error } = sanitizePersonaFields(data);
        if (error) {
          ack?.({ ok: false, error });
          return;
        }
        let model = fields.model ?? '';
        if (model) {
          const validation = await validateModel(model);
          if (!validation.valid) {
            ack?.({ ok: false, error: validation.error, availableModels: validation.availableModels });
            return;
          }
        } else {
          const listed = await ollama.list();
          model = listed.models[0]?.name || '';
        }
        if (!model) {
          ack?.({ ok: false, error: 'No models installed' });
          return;
        }
        const name = fields.name;
        const systemPrompt = fields.systemPrompt;
        if (!name || !systemPrompt) {
          ack?.({ ok: false, error: 'Persona name and system prompt are required' });
          return;
        }

        const row = createPersonaRow({
          id: randomUUID(),
          name,
          model,
          systemPrompt,
          temperature: fields.temperature ?? 0.7,
          enabled: fields.enabled ?? true,
          enabledTools: fields.enabledTools ?? false,
          description: fields.description,
          avatar: fields.avatar,
          userId: user.id,
        }, user.id);
        const AgentClass = row.enabledTools ? ToolEnabledDefaultAgent : DefaultAgent;
        registry.register(row, AgentClass);
        socket.emit('personas:list', registry.getAllPersonas(user.id));
        ack?.({ ok: true, persona: row });
      } catch (error) {
        console.error('persona:create failed', error);
        ack?.({ ok: false, error: 'Failed to create persona' });
      }
    });

    socket.on('persona:update', async (payload: unknown, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const { id, patch } = (payload && typeof payload === 'object' ? payload : {}) as {
        id?: unknown;
        patch?: unknown;
      };
      const personaId = String(id ?? '');
      const existing = registry.getPersona(personaId, user.id);
      if (!existing) {
        ack?.({ ok: false, error: 'Persona not found' });
        return;
      }
      const { fields, error } = sanitizePersonaFields(patch);
      if (error) {
        ack?.({ ok: false, error });
        return;
      }
      if (fields.model) {
        const validation = await validateModel(fields.model);
        if (!validation.valid) {
          ack?.({ ok: false, error: validation.error, availableModels: validation.availableModels });
          return;
        }
      }
      const row = updatePersonaRow(personaId, user.id, fields);
      if (!row) {
        ack?.({ ok: false, error: 'Persona not found' });
        return;
      }
      if (existing.enabledTools !== row.enabledTools) {
        registry.unregister(row.id);
        const AgentClass = row.enabledTools ? ToolEnabledDefaultAgent : DefaultAgent;
        registry.register(row, AgentClass);
      } else {
        registry.updatePersona(row.id, user.id, row);
      }
      socket.emit('personas:list', registry.getAllPersonas(user.id));
      ack?.({ ok: true, persona: row });
    });

    socket.on('persona:delete', (id: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      if (!deletePersonaRow(String(id), user.id)) {
        ack?.({ ok: false, error: 'Persona not found' });
        return;
      }
      registry.unregister(String(id));
      socket.emit('personas:list', registry.getAllPersonas(user.id));
      ack?.({ ok: true });
    });

    socket.on('persona:toggle', (id: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const enabled = registry.toggleAgent(String(id), user.id);
      if (enabled === undefined) {
        ack?.({ ok: false, error: 'Persona not found' });
        return;
      }
      socket.emit('personas:list', registry.getAllPersonas(user.id));
      ack?.({ ok: true, enabled });
    });

    socket.on('personas:list', (ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      socket.emit('personas:list', registry.getAllPersonas(user.id));
      ack?.(registry.getAllPersonas(user.id));
    });

    socket.on('conversation:list', (ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const conversations = getConversations(user.id);
      socket.emit('conversation:list', conversations);
      ack?.(conversations);
    });

    socket.on('conversation:create', async (title?: string | null, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      if (!(await checkCreateRateLimit(socket.id))) {
        ack?.({ ok: false, error: 'Rate limit exceeded' });
        return;
      }
      const conversation = createConversation(title || 'New Conversation', user.id);
      socket.join(conversation.id);
      socket.emit('conversation:created', conversation);
      emitConversationList(io, user.id);
      ack?.({ ok: true, conversation });
    });

    socket.on('conversation:delete', (id: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const deleted = dbDeleteConversation(String(id), user.id);
      if (!deleted) {
        ack?.({ ok: false, error: 'Conversation not found' });
        return;
      }
      socket.leave(String(id));
      emitConversationList(io, user.id);
      io.to(userRoom(user.id)).emit('conversation:deleted', String(id));
      ack?.({ ok: true });
    });

    socket.on('conversation:rename', ({ id, title }: { id: string; title: string }, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const renamed = dbRenameConversation(String(id), user.id, String(title || ''));
      if (!renamed) {
        ack?.({ ok: false, error: 'Conversation not found' });
        return;
      }
      emitConversationList(io, user.id);
      ack?.({ ok: true });
    });

    socket.on('conversations:clear', (ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      dbClearConversations(user.id);
      io.to(userRoom(user.id)).emit('conversations:cleared');
      emitConversationList(io, user.id);
      ack?.({ ok: true });
    });

    socket.on('data:export', (ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      ack?.(exportAllData(user.id));
    });

    socket.on('data:import', (data: unknown, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const result = importAllData(data, user.id);
      if (result.ok) {
        syncUserPersonas(registry, user.id);
        socket.emit('personas:list', registry.getAllPersonas(user.id));
        emitConversationList(io, user.id);
      }
      ack?.(result);
    });

    socket.on('conversation:import', (data: unknown, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const parsed = ConversationImportSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'Invalid import format' });
        return;
      }
      try {
        const conversation = createConversation(parsed.data.title || 'Imported Conversation', user.id);
        for (const message of parsed.data.messages) {
          createMessage(
            conversation.id,
            message.role,
            message.content,
            undefined,
            message.agentName,
            false,
            undefined,
            message.createdAt,
          );
        }
        emitConversationList(io, user.id);
        ack?.({ ok: true, conversation });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'Import failed' });
      }
    });

    socket.on('message:delete', (id: string, ack?: Ack) => {
      const user = requireUser(socket, ack);
      if (!user) return;
      const result = deleteMessageRow(String(id), user.id);
      if (!result.ok || !result.conversationId) {
        ack?.({ ok: false, error: 'Message not found' });
        return;
      }
      io.to(result.conversationId).emit('message:deleted', {
        conversationId: result.conversationId,
        id: String(id),
      });
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      cleanupRateLimit(socket.id);
    });
  });
}
