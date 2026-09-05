import Database, { Database as DatabaseType } from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { Conversation, Message, Persona } from '@ai-conv/types';
import { randomUUID } from 'crypto';
import { migrate } from './migrate.js';

// Keep local development on one database regardless of whether the backend
// is launched from the repository root, the backend workspace, or dist/.
// Packaged/Docker launches provide DATABASE_PATH explicitly.
const DEFAULT_DB_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'ai-conv.db');
const DB_PATH = process.env.DATABASE_PATH || DEFAULT_DB_PATH;
mkdirSync(dirname(DB_PATH), { recursive: true });

// This is the only application SQLite handle. Every query and migration uses it.
export const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
migrate(db);

export interface PersonaRow extends Persona {
  userId?: string;
  created_at?: string;
}

function mapPersonaRow(row: any): PersonaRow {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    systemPrompt: row.system_prompt,
    temperature: Number(row.temperature),
    enabled: Boolean(row.enabled),
    enabledTools: Boolean(row.enabledTools),
    description: row.description || undefined,
    avatar: row.avatar || undefined,
    userId: row.user_id || undefined,
    created_at: row.created_at,
  };
}

export function createPersonaRow(persona: PersonaRow, userId: string): PersonaRow {
  const owned = { ...persona, userId };
  db.prepare(
    `INSERT INTO personas
      (id, name, model, system_prompt, temperature, enabled, enabledTools, description, avatar, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    owned.id,
    owned.name,
    owned.model,
    owned.systemPrompt,
    owned.temperature,
    owned.enabled ? 1 : 0,
    owned.enabledTools ? 1 : 0,
    owned.description || null,
    owned.avatar || null,
    userId,
    new Date().toISOString(),
  );
  return owned;
}

export function getPersonas(userId?: string): PersonaRow[] {
  const rows = (userId
    ? db.prepare('SELECT * FROM personas WHERE user_id = ? ORDER BY created_at ASC').all(userId)
    : db.prepare('SELECT * FROM personas ORDER BY created_at ASC').all()) as any[];
  return rows.map(mapPersonaRow);
}

export function getPersona(id: string, userId: string): PersonaRow | null {
  const row = db.prepare('SELECT * FROM personas WHERE id = ? AND user_id = ?').get(id, userId) as any;
  return row ? mapPersonaRow(row) : null;
}

export function updatePersonaRow(id: string, userId: string, patch: Partial<Persona>): PersonaRow | null {
  const existing = getPersona(id, userId);
  if (!existing) return null;

  const merged = {
    name: patch.name ?? existing.name,
    model: patch.model ?? existing.model,
    systemPrompt: patch.systemPrompt ?? existing.systemPrompt,
    temperature: patch.temperature ?? existing.temperature,
    enabled: patch.enabled ?? existing.enabled,
    enabledTools: patch.enabledTools ?? existing.enabledTools,
    description: patch.description ?? existing.description,
    avatar: patch.avatar ?? existing.avatar,
  };

  db.prepare(
    `UPDATE personas
     SET name = ?, model = ?, system_prompt = ?, temperature = ?, enabled = ?,
         enabledTools = ?, description = ?, avatar = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    merged.name,
    merged.model,
    merged.systemPrompt,
    merged.temperature,
    merged.enabled ? 1 : 0,
    merged.enabledTools ? 1 : 0,
    merged.description || null,
    merged.avatar || null,
    id,
    userId,
  );

  return { ...existing, ...merged, userId };
}

export function deletePersonaRow(id: string, userId: string): boolean {
  return db.prepare('DELETE FROM personas WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export interface UserRow {
  id: string;
  name: string;
  avatar?: string;
  created_at: string;
}

export function getUsers(): UserRow[] {
  return db.prepare('SELECT id, name, avatar, created_at FROM users ORDER BY created_at ASC').all() as UserRow[];
}

export function getUser(id: string): UserRow | null {
  return db.prepare('SELECT id, name, avatar, created_at FROM users WHERE id = ?').get(id) as UserRow | null;
}

export function createUser(name: string, avatar?: string): UserRow {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO users (id, name, avatar, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name.slice(0, 40), avatar || null, createdAt);
  return { id, name: name.slice(0, 40), avatar, created_at: createdAt };
}

export function claimUnownedData(userId: string): void {
  const transaction = db.transaction(() => {
    db.prepare('UPDATE conversations SET user_id = ? WHERE user_id IS NULL').run(userId);
    db.prepare('UPDATE personas SET user_id = ? WHERE user_id IS NULL').run(userId);
  });
  transaction();
}

export function deleteUserRow(id: string): boolean {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM conversations WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM personas WHERE user_id = ?').run(id);
    return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
  });
  return transaction();
}

export function createConversation(title: string, userId: string, id: string = randomUUID()): Conversation {
  const safeTitle = title.trim().slice(0, 120) || 'New Conversation';
  const now = new Date().toISOString();
  const conversationId = id as `${string}-${string}-${string}-${string}-${string}`;
  db.prepare(
    `INSERT INTO conversations (id, title, created_at, updated_at, user_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(conversationId, safeTitle, now, now, userId);
  return { id: conversationId, title: safeTitle, createdAt: now, updatedAt: now, userId };
}

export function ensureConversation(conversationId: string, userId: string): Conversation | null {
  const existing = getConversation(conversationId);
  if (existing) return existing.userId === userId ? existing : null;
  return createConversation(
    'New Conversation',
    userId,
    conversationId as `${string}-${string}-${string}-${string}-${string}`,
  );
}

export function getConversations(userId: string): Conversation[] {
  const rows = db.prepare(
    'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(userId) as any[];
  return rows.map(mapConversationRow);
}

function parseParticipants(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')
      ? parsed
      : undefined;
  } catch {
    // A malformed legacy row must not crash conversation-list/history events.
    return undefined;
  }
}

function mapConversationRow(row: any): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id || undefined,
    participants: parseParticipants(row.participants),
  };
}

export function getConversation(id: string, userId?: string): Conversation | null {
  const row = (userId
    ? db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(id, userId)
    : db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)) as any;
  return row ? mapConversationRow(row) : null;
}

export function updateConversationTimestamp(id: string, userId?: string): boolean {
  const result = userId
    ? db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?').run(new Date().toISOString(), id, userId)
    : db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return result.changes > 0;
}

export function deleteConversation(id: string, userId: string): boolean {
  return db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function renameConversation(id: string, userId: string, title: string): boolean {
  return db.prepare(
    'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ).run(title.trim().slice(0, 120), new Date().toISOString(), id, userId).changes > 0;
}

export function clearConversations(userId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE user_id = ?').get(userId) as { count: number };
  db.prepare('DELETE FROM conversations WHERE user_id = ?').run(userId);
  return row.count;
}

export function setParticipants(id: string, userId: string, participants: string[]): boolean {
  return db.prepare('UPDATE conversations SET participants = ? WHERE id = ? AND user_id = ?')
    .run(participants.length ? JSON.stringify(participants) : null, id, userId).changes > 0;
}

export function getParticipants(id: string, userId?: string): string[] | null {
  const row = (userId
    ? db.prepare('SELECT participants FROM conversations WHERE id = ? AND user_id = ?').get(id, userId)
    : db.prepare('SELECT participants FROM conversations WHERE id = ?').get(id)) as any;
  return parseParticipants(row?.participants) ?? null;
}

export function deleteMessageRow(id: string, userId: string): { ok: boolean; conversationId?: string; role?: string } {
  const row = db.prepare(
    `SELECT m.conversation_id, m.role
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = ? AND c.user_id = ?`
  ).get(id, userId) as any;
  if (!row) return { ok: false };
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  return { ok: true, conversationId: row.conversation_id, role: row.role };
}

export function regenerateMessage(
  messageId: string,
  userId: string,
): { ok: boolean; conversationId?: string; userMessageContent?: string; agentId?: string; deletedMessageIds?: string[] } {
  const transaction = db.transaction(() => {
    const row = db.prepare(
      `SELECT m.rowid, m.conversation_id, m.role, m.agent_id
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND c.user_id = ?`
    ).get(messageId, userId) as { rowid: number; conversation_id: string; role: string; agent_id?: string } | undefined;
    if (!row || row.role !== 'agent') return { ok: false, conversationId: row?.conversation_id };

    const userMessage = db.prepare(
      `SELECT content FROM messages
       WHERE conversation_id = ? AND role = 'user' AND rowid < ?
       ORDER BY rowid DESC LIMIT 1`
    ).get(row.conversation_id, row.rowid) as { content?: string } | undefined;

    const deletedMessages = db.prepare(
      `SELECT id FROM messages WHERE conversation_id = ? AND rowid >= ?`
    ).all(row.conversation_id, row.rowid) as { id: string }[];

    db.prepare('DELETE FROM messages WHERE conversation_id = ? AND rowid >= ?')
      .run(row.conversation_id, row.rowid);

    return {
      ok: true,
      conversationId: row.conversation_id,
      userMessageContent: userMessage?.content,
      agentId: row.agent_id || undefined,
      deletedMessageIds: deletedMessages.map((m) => m.id),
    };
  });
  return transaction();
}

export function createMessage(
  conversationId: string,
  role: Message['role'],
  content: string,
  agentId?: string,
  agentName?: string,
  isStreaming = false,
  id?: string,
  createdAt?: string,
): Message {
  const messageId = id ?? randomUUID();
  const timestamp = createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO messages
      (id, conversation_id, role, content, agent_id, agent_name, created_at, is_streaming)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(messageId, conversationId, role, content, agentId || null, agentName || null, timestamp, isStreaming ? 1 : 0);
  return {
    id: messageId,
    conversationId,
    role,
    content,
    agentId,
    agentName,
    createdAt: timestamp,
    isStreaming,
  };
}

export function updateMessageContent(id: string, content: string, isStreaming = false): void {
  db.prepare('UPDATE messages SET content = ?, is_streaming = ? WHERE id = ?')
    .run(content, isStreaming ? 1 : 0, id);
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  agent_id: string | null;
  agent_name: string | null;
  created_at: string;
  is_streaming: number;
}

function mapMessageRow(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Message['role'],
    content: row.content,
    agentId: row.agent_id || undefined,
    agentName: row.agent_name || undefined,
    createdAt: row.created_at,
    isStreaming: Boolean(row.is_streaming),
  };
}

export function getMessages(conversationId: string, userId?: string): Message[] {
  const rows = (userId
    ? db.prepare(
      `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id = ? AND c.user_id = ? ORDER BY m.rowid ASC`
    ).all(conversationId, userId)
    : db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid ASC').all(conversationId)) as MessageRow[];
  return rows.map(mapMessageRow);
}

export function getMessagePage(
  conversationId: string,
  userId: string,
  limit = 100,
  beforeId?: string,
): { messages: Message[]; hasMore: boolean } {
  const capped = Math.min(Math.max(limit, 1), 500);
  const owner = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
  if (!owner) return { messages: [], hasMore: false };

  const beforeRow = beforeId
    ? db.prepare('SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?').get(beforeId, conversationId) as { rowid: number } | undefined
    : undefined;
  if (beforeId && !beforeRow) return { messages: [], hasMore: false };
  const boundary = beforeRow?.rowid;
  const rows = (boundary === undefined
    ? db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT ?').all(conversationId, capped + 1)
    : db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?').all(conversationId, boundary, capped + 1)) as MessageRow[];
  const hasMore = rows.length > capped;
  return { messages: rows.slice(0, capped).reverse().map(mapMessageRow), hasMore };
}

export function getMessage(id: string, userId?: string): Message | null {
  const row = (userId
    ? db.prepare(
      `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND c.user_id = ?`
    ).get(id, userId)
    : db.prepare('SELECT * FROM messages WHERE id = ?').get(id)) as MessageRow | undefined;
  return row ? mapMessageRow(row) : null;
}

export interface ExportData {
  conversations: Conversation[];
  messages: Message[];
  personas: PersonaRow[];
}

export function exportAllData(userId: string): ExportData {
  const conversations = getConversations(userId);
  const messages = conversations.flatMap((conversation) => getMessages(conversation.id, userId));
  return { conversations, messages, personas: getPersonas(userId) };
}

export function importAllData(
  data: unknown,
  userId: string,
): { ok: boolean; error?: string; stats?: { conversations: number; messages: number; personas: number } } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Invalid import format: expected an object' };
  }
  const raw = data as Record<string, unknown>;
  if (raw.conversations !== undefined && !Array.isArray(raw.conversations)) return { ok: false, error: 'Invalid format: "conversations" must be an array' };
  if (raw.messages !== undefined && !Array.isArray(raw.messages)) return { ok: false, error: 'Invalid format: "messages" must be an array' };
  if (raw.personas !== undefined && !Array.isArray(raw.personas)) return { ok: false, error: 'Invalid format: "personas" must be an array' };

  const importedConversations = (raw.conversations || []) as any[];
  const importedMessages = (raw.messages || []) as any[];
  const importedPersonas = (raw.personas || []) as any[];
  if (importedConversations.length === 0 && importedMessages.length === 0 && importedPersonas.length === 0) {
    return { ok: false, error: 'Nothing to import — file contains no conversations, messages, or personas' };
  }

  try {
    const conversationIds = new Map<string, string>();
    const transaction = db.transaction(() => {
      for (const conversation of importedConversations) {
        if (!conversation || typeof conversation.id !== 'string' || typeof conversation.title !== 'string') {
          throw new Error('Invalid conversation record');
        }

        const existing = getConversation(conversation.id, userId);
        if (existing) {
          conversationIds.set(conversation.id, existing.id);
          renameConversation(existing.id, userId, conversation.title);
          continue;
        }

        // Imported IDs are not globally unique across profiles. If another
        // user already owns this ID, remap the imported graph instead of
        // allowing a UNIQUE constraint error or overwriting their data.
        const importedId = getConversation(conversation.id) ? randomUUID() : conversation.id;
        conversationIds.set(conversation.id, importedId);
        createConversation(conversation.title, userId, importedId);
      }

      for (const message of importedMessages) {
        if (!message || typeof message.id !== 'string' || typeof message.conversationId !== 'string') {
          throw new Error('Invalid message record');
        }
        const conversationId = conversationIds.get(message.conversationId) || message.conversationId;
        const owner = getConversation(conversationId, userId);
        if (!owner) continue;

        const existing = getMessage(message.id, userId);
        if (existing) continue;
        const messageId = getMessage(message.id) ? randomUUID() : message.id;
        createMessage(conversationId, message.role, String(message.content || ''), message.agentId, message.agentName, Boolean(message.isStreaming), messageId, message.createdAt);
      }

      for (const persona of importedPersonas) {
        if (!persona || typeof persona.id !== 'string' || typeof persona.name !== 'string') {
          throw new Error('Invalid persona record');
        }
        const existing = getPersona(persona.id, userId);
        if (existing) {
          updatePersonaRow(persona.id, userId, persona);
          continue;
        }
        const personaId = getPersonas().some((candidate) => candidate.id === persona.id)
          ? randomUUID()
          : persona.id;
        createPersonaRow({ ...persona, id: personaId, enabled: persona.enabled !== false, enabledTools: Boolean(persona.enabledTools) }, userId);
      }
    });
    transaction();
    return { ok: true, stats: { conversations: importedConversations.length, messages: importedMessages.length, personas: importedPersonas.length } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Import failed' };
  }
}
