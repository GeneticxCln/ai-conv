import { describe, it, expect } from 'vitest';
import { truncateHistory, MAX_HISTORY } from './utils';
import { Message } from './types';

const makeMsg = (id: string, conversationId = 'c1'): Message => ({
  id,
  conversationId,
  role: 'user',
  content: `message ${id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  isStreaming: false,
});

describe('truncateHistory', () => {
  it('returns the full array when under the limit', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => makeMsg(`m${i}`));
    expect(truncateHistory(msgs)).toHaveLength(10);
    expect(truncateHistory(msgs)).toBe(msgs); // same reference — no copy
  });

  it('returns the full array when exactly at the limit', () => {
    const msgs = Array.from({ length: MAX_HISTORY }, (_, i) => makeMsg(`m${i}`));
    expect(truncateHistory(msgs)).toHaveLength(MAX_HISTORY);
  });

  it('trims to the most recent N messages when over the limit', () => {
    const msgs = Array.from({ length: 60 }, (_, i) => makeMsg(`m${i}`));
    const result = truncateHistory(msgs);
    expect(result).toHaveLength(MAX_HISTORY);
    // Should keep the last 40
    expect(result[0].id).toBe('m20');
    expect(result[result.length - 1].id).toBe('m59');
  });

  it('handles empty array', () => {
    expect(truncateHistory([])).toEqual([]);
  });

  it('uses custom limit when provided', () => {
    const msgs = Array.from({ length: 15 }, (_, i) => makeMsg(`m${i}`));
    const result = truncateHistory(msgs, 5);
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe('m10');
  });
});
