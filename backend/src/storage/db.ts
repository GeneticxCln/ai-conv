import Database, { Database as DatabaseType } from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { Conversation, Message } from '../types';
import { randomUUID } from 'crypto';

const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'ai-conv.db');

mkdirSync(join(DB_PATH, '..'), { recursive: true });

export const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
      content TEXT NOT NULL,
      agent_id TEXT,
      agent_name TEXT,
      created_at TEXT NOT NULL,
      is_streaming INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'llama3.1:8b',
      system_prompt TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.7,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Lightweight column migrations
  const convCols = db.prepare("PRAGMA table_info(conversations)").all() as any[];
  const colNames = convCols.map(c => c.name);
  if (!colNames.includes('user_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN user_id TEXT");
  }
  if (!colNames.includes('participants')) {
    db.exec("ALTER TABLE conversations ADD COLUMN participants TEXT");
  }
}

migrate();

// ============ Personas (user-created, stored in DB) ============
export interface PersonaRow {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  enabled: boolean;
  description?: string;
  avatar?: string;
}

export function createPersonaRow(p: PersonaRow): PersonaRow {
  db.prepare(
    `INSERT INTO personas (id, name, model, system_prompt, temperature, enabled, description, avatar, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.id, p.name, p.model, p.systemPrompt, p.temperature, p.enabled ? 1 : 0, p.description || null, p.avatar || null, new Date().toISOString());
  return p;
}

export function getPersonas(): PersonaRow[] {
  const rows = db.prepare('SELECT * FROM personas ORDER BY created_at ASC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    model: r.model,
    systemPrompt: r.system_prompt,
    temperature: r.temperature,
    enabled: Boolean(r.enabled),
    description: r.description || undefined,
    avatar: r.avatar || undefined,
  }));
}

export function updatePersonaRow(id: string, patch: Partial<PersonaRow>): PersonaRow | null {
  const existing = db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as any;
  if (!existing) return null;
  const merged = {
    name: patch.name ?? existing.name,
    model: patch.model ?? existing.model,
    systemPrompt: patch.systemPrompt ?? existing.system_prompt,
    temperature: patch.temperature ?? existing.temperature,
    enabled: (patch.enabled ?? Boolean(existing.enabled)) ? 1 : 0,
    description: patch.description ?? existing.description,
    avatar: patch.avatar ?? existing.avatar,
  };
  db.prepare(
    `UPDATE personas SET name=?, model=?, system_prompt=?, temperature=?, enabled=?, description=?, avatar=? WHERE id=?`
  ).run(merged.name, merged.model, merged.systemPrompt, merged.temperature, merged.enabled, merged.description, merged.avatar, id);
  return { id, ...merged, enabled: Boolean(merged.enabled), description: merged.description || undefined, avatar: merged.avatar || undefined } as PersonaRow;
}

export function deletePersonaRow(id: string): boolean {
  const res = db.prepare('DELETE FROM personas WHERE id = ?').run(id);
  return res.changes > 0;
}

migrate();

// ============ Users ============
export interface UserRow {
  id: string;
  name: string;
  avatar?: string;
}

export function createUser(name: string, avatar?: string): UserRow {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, name, avatar, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name.slice(0, 40), avatar || null, new Date().toISOString());
  return { id, name: name.slice(0, 40), avatar };
}

export function getUsers(): UserRow[] {
  return (db.prepare('SELECT id, name, avatar FROM users ORDER BY created_at ASC').all() as any[])
    .map(r => ({ id: r.id, name: r.name, avatar: r.avatar || undefined }));
}

export function deleteUserRow(id: string): boolean {
  db.prepare('UPDATE conversations SET user_id = NULL WHERE user_id = ?').run(id);
  return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}

// ============ Conversations ============
export interface ConversationFull extends Conversation {
  userId?: string;
  participants?: string[];
}

export function createConversation(title?: string, userId?: string, participants?: string[]): ConversationFull {
  const safeTitle = (title ?? '').trim().slice(0, 120) || 'New Conversation';
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at, user_id, participants) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, safeTitle, now, now, userId || null, participants && participants.length ? JSON.stringify(participants) : null);
  return { id, title: safeTitle, createdAt: now, updatedAt: now, userId, participants };
}

export function ensureConversation(id: string): Conversation {
  const existing = getConversation(id);
  if (existing) return existing;
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(id, 'New Conversation', now, now);
  return { id, title: 'New Conversation', createdAt: now, updatedAt: now };
}

export function getConversations(userId?: string): ConversationFull[] {
  const rows = (userId
    ? db.prepare('SELECT * FROM conversations WHERE user_id = ? OR user_id IS NULL ORDER BY updated_at DESC').all(userId)
    : db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all()) as any[];
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    userId: r.user_id || undefined,
    participants: r.participants ? JSON.parse(r.participants) : undefined,
  }));
}

export function getConversation(id: string): Conversation | null {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateConversationTimestamp(id: string) {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

export function deleteConversation(id: string) {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function renameConversation(id: string, title: string): boolean {
  const res = db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title.slice(0, 120), new Date().toISOString(), id);
  return res.changes > 0;
}

export function clearConversations(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM conversations').get() as any;
  db.exec('DELETE FROM messages; DELETE FROM conversations;');
  return row.c;
}

export function setParticipants(id: string, participants: string[]): boolean {
  const res = db.prepare('UPDATE conversations SET participants = ? WHERE id = ?')
    .run(participants.length ? JSON.stringify(participants) : null, id);
  return res.changes > 0;
}

export function getParticipants(id: string): string[] | null {
  const row = db.prepare('SELECT participants FROM conversations WHERE id = ?').get(id) as any;
  if (!row || !row.participants) return null;
  try { return JSON.parse(row.participants); } catch { return null; }
}

// ============ Message ops ============
export function deleteMessageRow(id: string): { ok: boolean; conversationId?: string; role?: string } {
  const row = db.prepare('SELECT conversation_id, role FROM messages WHERE id = ?').get(id) as any;
  if (!row) return { ok: false };
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  return { ok: true, conversationId: row.conversation_id, role: row.role };
}

// ============ Messages ============
export function createMessage(
  conversationId: string,
  role: Message['role'],
  content: string,
  agentId?: string,
  agentName?: string,
  isStreaming = false,
  id?: string
): Message {
  const now = new Date().toISOString();
  const messageId = id ?? randomUUID();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, agent_id, agent_name, created_at, is_streaming)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(messageId, conversationId, role, content, agentId || null, agentName || null, now, isStreaming ? 1 : 0);
  return {
    id: messageId,
    conversationId,
    role,
    content,
    agentId,
    agentName,
    createdAt: now,
    isStreaming,
  };
}

export function updateMessageContent(id: string, content: string, isStreaming = false) {
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

function mapMessageRow(r: MessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as Message['role'],
    content: r.content,
    agentId: r.agent_id || undefined,
    agentName: r.agent_name || undefined,
    createdAt: r.created_at,
    isStreaming: Boolean(r.is_streaming),
  };
}

export function getMessages(conversationId: string): Message[] {
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as MessageRow[];
  return rows.map(mapMessageRow);
}

/** Newest-first page of a conversation, bounded to `limit` rows; returned oldest-first. */
export function getMessagePage(conversationId: string, limit = 100, beforeCreatedAt?: string): Message[] {
  const capped = Math.min(Math.max(limit, 1), 500);
  const rows: MessageRow[] = beforeCreatedAt
    ? db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
        .all(conversationId, beforeCreatedAt, capped) as MessageRow[]
    : db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(conversationId, capped) as MessageRow[];
  return rows.map(mapMessageRow).reverse();
}

export function getMessage(id: string): Message | null {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    agentId: row.agent_id || undefined,
    agentName: row.agent_name || undefined,
    createdAt: row.created_at,
    isStreaming: Boolean(row.is_streaming),
  };
}
