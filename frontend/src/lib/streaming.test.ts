import { describe, it, expect } from 'vitest';
import { applyAgentToken } from './streaming';
import { Message } from '../types';

const base: Message = {
  id: 'm1',
  conversationId: 'c1',
  role: 'agent',
  content: 'Hello',
  agentId: 'a1',
  agentName: 'Alex',
  createdAt: '2026-01-01T00:00:00.000Z',
  isStreaming: true,
};

describe('applyAgentToken', () => {
  it('creates a new streaming message for an unknown id', () => {
    const result = applyAgentToken([], {
      conversationId: 'c1',
      messageId: 'm2',
      agentId: 'a1',
      agentName: 'Alex',
      token: 'Hi',
      isDone: false,
    }, () => '2026-01-01T00:00:01.000Z');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'm2',
      role: 'agent',
      content: 'Hi',
      isStreaming: true,
    });
  });

  it('appends tokens to the existing streaming message', () => {
    const result = applyAgentToken([base], {
      conversationId: 'c1',
      messageId: 'm1',
      agentId: 'a1',
      agentName: 'Alex',
      token: ' world',
      isDone: false,
    });

    expect(result[0].content).toBe('Hello world');
    expect(result[0].isStreaming).toBe(true);
  });

  it('ignores done markers without mutating content', () => {
    const result = applyAgentToken([base], {
      conversationId: 'c1',
      messageId: 'm1',
      agentId: 'a1',
      agentName: 'Alex',
      token: '',
      isDone: true,
    });

    expect(result).toEqual([base]);
  });

  it('does not mutate the input array', () => {
    const input = [base];
    applyAgentToken(input, {
      conversationId: 'c1',
      messageId: 'm1',
      agentId: 'a1',
      agentName: 'Alex',
      token: '!',
      isDone: false,
    });
    expect(input[0].content).toBe('Hello');
  });
});
