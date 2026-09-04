import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

// We test the rowid-based deletion logic directly against a temp database
// to prove that regenerating a message in one conversation never touches
// messages from another conversation — even when they share timestamps.

const TMP_DB = `/tmp/ai-conv-regenerate-test-${randomUUID().slice(0, 8)}.db`;

function setupDb() {
  const db = new Database(TMP_DB);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
      content TEXT NOT NULL,
      agent_id TEXT,
      agent_name TEXT,
      created_at TEXT NOT NULL,
      is_streaming INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_messages_conversation ON messages (conversation_id);
  `);
  return db;
}

function insertMsg(
  db: Database.Database,
  id: string,
  convId: string,
  role: string,
  content: string,
  createdAt: string,
  agentName?: string,
) {
  const stmt = db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, agent_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  stmt.run(id, convId, role, content, agentName || null, createdAt);
}

// Re-implementation of regenerateMessage using rowid (mirrors db.ts)
function regenerateMessage(
  db: Database.Database,
  messageId: string,
): { ok: boolean; conversationId?: string; userMessageContent?: string } {
  const row = db.prepare(
    'SELECT rowid, conversation_id, role, content, created_at FROM messages WHERE id = ?'
  ).get(messageId) as any;
  if (!row) return { ok: false };
  if (row.role !== 'agent') return { ok: false, conversationId: row.conversation_id };

  db.prepare('DELETE FROM messages WHERE conversation_id = ? AND rowid >= ?')
    .run(row.conversation_id, row.rowid);

  const userMsg = db.prepare(
    `SELECT content FROM messages
     WHERE conversation_id = ? AND role = 'user' AND rowid < ?
     ORDER BY rowid DESC LIMIT 1`
  ).get(row.conversation_id, row.rowid) as any;

  return {
    ok: true,
    conversationId: row.conversation_id,
    userMessageContent: userMsg?.content,
  };
}

describe('regenerateMessage (rowid-based deletion)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
    try { rmSync(TMP_DB); } catch { /* ignore */ }
  });

  it('deletes only the target agent message and later messages in the same conversation', () => {
    // Conv A: user, agent, user, agent
    // Conv B: user, agent (inserted between Conv A messages, same timestamps)
    const sameTime = '2026-08-24T12:00:00.000Z';
    insertMsg(db, 'a1', 'convA', 'user', 'Hello A', sameTime);
    insertMsg(db, 'b1', 'convB', 'user', 'Hello B', sameTime); // same timestamp!
    insertMsg(db, 'a2', 'convA', 'agent', 'Reply A1', sameTime, 'AgentA');
    insertMsg(db, 'b2', 'convB', 'agent', 'Reply B1', sameTime, 'AgentB');
    insertMsg(db, 'a3', 'convA', 'user', 'Follow up A', sameTime);
    insertMsg(db, 'a4', 'convA', 'agent', 'Reply A2', sameTime, 'AgentA');

    // Regenerate a2 (first agent response in convA)
    const result = regenerateMessage(db, 'a2');
    expect(result.ok).toBe(true);
    expect(result.conversationId).toBe('convA');
    expect(result.userMessageContent).toBe('Hello A');

    // Conv A: only 'a1' should remain (user msg before the regenerated agent)
    const convARemaining = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid'
    ).all('convA') as any[];
    expect(convARemaining.map((r: any) => r.id)).toEqual(['a1']);

    // Conv B: ALL messages should be untouched
    const convBRemaining = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid'
    ).all('convB') as any[];
    expect(convBRemaining.map((r: any) => r.id)).toEqual(['b1', 'b2']);
  });

  it('returns the correct user message content (not its own content)', () => {
    insertMsg(db, 'm1', 'c1', 'user', 'Question 1', '2026-01-01T00:00:00.000Z');
    insertMsg(db, 'm2', 'c1', 'agent', 'Answer 1', '2026-01-01T00:00:01.000Z');
    insertMsg(db, 'm3', 'c1', 'user', 'Question 2', '2026-01-01T00:00:02.000Z');
    insertMsg(db, 'm4', 'c1', 'agent', 'Answer 2', '2026-01-01T00:00:03.000Z');

    // Regenerate the second agent message
    const result = regenerateMessage(db, 'm4');
    expect(result.ok).toBe(true);
    // Should return the user message that triggered it (Question 2), not its own content
    expect(result.userMessageContent).toBe('Question 2');

    // Verify only m1-m3 remain (m4 was deleted, m3 is before it)
    const remaining = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid'
    ).all('c1') as any[];
    expect(remaining.map((r: any) => r.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns ok: false for non-existent messageId', () => {
    const result = regenerateMessage(db, 'nonexistent');
    expect(result.ok).toBe(false);
    expect(result.conversationId).toBeUndefined();
  });

  it('returns ok: false for a user message (not agent)', () => {
    insertMsg(db, 'u1', 'c1', 'user', 'Hello', '2026-01-01T00:00:00.000Z');
    const result = regenerateMessage(db, 'u1');
    expect(result.ok).toBe(false);
    // conversation_id is returned so the caller can scope the error
    expect(result.conversationId).toBe('c1');
  });

  it('does not delete any messages when target is a user message', () => {
    insertMsg(db, 'u1', 'c1', 'user', 'Hello', '2026-01-01T00:00:00.000Z');
    insertMsg(db, 'a1', 'c1', 'agent', 'Reply', '2026-01-01T00:00:01.000Z');

    const result = regenerateMessage(db, 'u1');
    expect(result.ok).toBe(false);

    // Both messages still exist
    const remaining = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid'
    ).all('c1') as any[];
    expect(remaining.map((r: any) => r.id)).toEqual(['u1', 'a1']);
  });

  it('when regenerating the last agent message, deletes only that message', () => {
    insertMsg(db, 'u1', 'c1', 'user', 'Hello', '2026-01-01T00:00:00.000Z');
    insertMsg(db, 'a1', 'c1', 'agent', 'Reply', '2026-01-01T00:00:01.000Z');

    const result = regenerateMessage(db, 'a1');
    expect(result.ok).toBe(true);
    expect(result.userMessageContent).toBe('Hello');

    const remaining = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid'
    ).all('c1') as any[];
    expect(remaining.map((r: any) => r.id)).toEqual(['u1']);
  });

  it('returns undefined userMessageContent when no user message exists before the agent', () => {
    // Edge case: agent message inserted without a preceding user message
    insertMsg(db, 'a1', 'c1', 'agent', 'Orphan agent', '2026-01-01T00:00:00.000Z');

    const result = regenerateMessage(db, 'a1');
    expect(result.ok).toBe(true);
    expect(result.userMessageContent).toBeUndefined();

    // Agent message still deleted
    const remaining = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ?'
    ).all('c1') as any[];
    expect(remaining.length).toBe(0);
  });

  it('interleaved insertions between two conversations maintain isolation', () => {
    // Simulate a real-world scenario: messages are inserted in the order
    // they arrive, regardless of conversation. Rowid must correctly
    // isolate deletion to the target conversation.
    //
    // Insertion order (simulating real chat app flow):
    // 1. convA: user "Q1"
    // 2. convB: user "Q2" 
    // 3. convA: agent "A1"
    // 4. convB: agent "B1"
    // 5. convA: user "Q3"
    // 6. convA: agent "A2"
    //
    // Regenerate A1 → delete A1, Q3, A2. Keep Q1, Q2, B1.
    insertMsg(db, 'q1', 'convA', 'user', 'Q1', '2026-01-01T00:00:00.000Z');
    insertMsg(db, 'q2', 'convB', 'user', 'Q2', '2026-01-01T00:00:01.000Z');
    insertMsg(db, 'a1', 'convA', 'agent', 'A1', '2026-01-01T00:00:02.000Z');
    insertMsg(db, 'b1', 'convB', 'agent', 'B1', '2026-01-01T00:00:03.000Z');
    insertMsg(db, 'q3', 'convA', 'user', 'Q3', '2026-01-01T00:00:04.000Z');
    insertMsg(db, 'a2', 'convA', 'agent', 'A2', '2026-01-01T00:00:05.000Z');

    const result = regenerateMessage(db, 'a1');
    expect(result.ok).toBe(true);
    expect(result.userMessageContent).toBe('Q1');

    const convA = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid'
    ).all('convA') as any[];
    expect(convA.map((r: any) => r.id)).toEqual(['q1']);

    const convB = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid'
    ).all('convB') as any[];
    expect(convB.map((r: any) => r.id)).toEqual(['q2', 'b1']);
  });
});