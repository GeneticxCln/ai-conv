import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createUser, importAllData } from './db.js';

// ── Helpers ────────────────────────────────────────────────────────
function ok(result: { ok: boolean; error?: string; stats?: any }) {
  return result.ok;
}
function errMsg(result: { ok: boolean; error?: string; stats?: any }) {
  return result.error ?? '';
}

// ── Tests ──────────────────────────────────────────────────────────
describe('importAllData — malformed input', () => {
  const userId = createUser(`ImportTest-${Date.now()}`).id;
  const testConversationId = randomUUID();
  const testMessageId = randomUUID();
  const testPersonaId = randomUUID();

  // Data base file — lightweight, inserts one conversation + one message
  // so tests that validate real imports work against the real DB.

  const validImport = {
    conversations: [
      { id: testConversationId, title: 'Test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    messages: [
      { id: testMessageId, conversationId: testConversationId, role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00.000Z', isStreaming: false },
    ],
    personas: [],
  };

  // ── Top-level shape ─────────────────────────────────────────
  describe('top-level validation', () => {
    it('rejects null', () => {
      const r = importAllData(null, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Invalid import format');
    });

    it('rejects undefined', () => {
      const r = importAllData(undefined, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Invalid import format');
    });

    it('rejects a string', () => {
      const r = importAllData('not json', userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Invalid import format');
    });

    it('rejects a number', () => {
      const r = importAllData(42, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Invalid import format');
    });

    it('rejects an array', () => {
      const r = importAllData([{ conversations: [] }], userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Invalid import format');
    });

    it('rejects a boolean', () => {
      const r = importAllData(true, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Invalid import format');
    });
  });

  // ── Nested field types ──────────────────────────────────────
  describe('nested field validation', () => {
    it('rejects conversations as a string', () => {
      const r = importAllData({ conversations: 'not-an-array' }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('"conversations" must be an array');
    });

    it('rejects conversations as a number', () => {
      const r = importAllData({ conversations: 123 }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('"conversations" must be an array');
    });

    it('rejects conversations as an object', () => {
      const r = importAllData({ conversations: { a: 1 } }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('"conversations" must be an array');
    });

    it('rejects messages as a string', () => {
      const r = importAllData({ messages: 'bad' }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('"messages" must be an array');
    });

    it('rejects messages as null', () => {
      const r = importAllData({ messages: null }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('"messages" must be an array');
    });

    it('rejects personas as a string', () => {
      const r = importAllData({ personas: 'bad' }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('"personas" must be an array');
    });
  });

  // ── Empty data ──────────────────────────────────────────────
  describe('empty data', () => {
    it('rejects empty object', () => {
      const r = importAllData({}, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Nothing to import');
    });

    it('rejects all-empty arrays', () => {
      const r = importAllData({ conversations: [], messages: [], personas: [] }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Nothing to import');
    });

    it('rejects only empty arrays even with extra keys', () => {
      const r = importAllData({ conversations: [], messages: [], personas: [], version: '1.0', exportedAt: '2026-01-01' }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Nothing to import');
    });
  });

  // ── Deeply malformed without crash ──────────────────────────
  describe('deeply malformed (no crash)', () => {
    it('handles conversations with null items', () => {
      const r = importAllData({ conversations: [null, undefined, 42] }, userId);
      // Should not crash — may fail at insert-time but must return a result.
      expect(r).toHaveProperty('ok');
      // Null/undefined items cause SQL constraint errors → ok:false caught by try/catch
      if (!r.ok) {
        expect(r.error).toBeTruthy();
      }
    });

    it('handles a deeply nested object with no arrays', () => {
      // Real-world: someone exports the wrong JSON format
      const r = importAllData({
        meta: { version: 1, date: '2026' },
        nested: { deeply: { inside: { here: true } } },
      }, userId);
      expect(ok(r)).toBe(false);
      expect(errMsg(r)).toContain('Nothing to import');
    });

    it('handles a huge payload with all wrong types', () => {
      const payload: any = { conversations: 'x', messages: 1, personas: false };
      for (let i = 0; i < 100; i++) payload[`key${i}`] = { n: i };
      const r = importAllData(payload, userId);
      expect(ok(r)).toBe(false);
      // Must not crash — catches the first validation error
    });

    it('handles undefined values inside arrays (partial import failure)', () => {
      const r = importAllData({
        conversations: [
          { id: testConversationId, title: 'Test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
        messages: [
          { id: testMessageId, conversationId: testConversationId, role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00.000Z', isStreaming: false },
          undefined,
        ],
        personas: [],
      }, userId);
      // Should not crash — returns result
      expect(r).toHaveProperty('ok');
    });
  });

  // ── Valid import still works ────────────────────────────────
  describe('valid import is still accepted', () => {
    it('accepts valid data', () => {
      const r = importAllData(validImport, userId);
      expect(ok(r)).toBe(true);
      expect(r.stats).toEqual({ conversations: 1, messages: 1, personas: 0 });
    });

    it('accepts only conversations', () => {
      const r = importAllData({ conversations: validImport.conversations }, userId);
      expect(ok(r)).toBe(true);
    });

    it('accepts only personas', () => {
      const r = importAllData({
        personas: [
          { id: testPersonaId, name: 'Helper', model: 'test', systemPrompt: '', temperature: 0.7, enabled: 1, enabledTools: '[]', description: '', avatar: '' },
        ],
      }, userId);
      expect(ok(r)).toBe(true);
    });
  });
});