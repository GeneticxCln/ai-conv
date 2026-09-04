import { describe, it, expect } from 'vitest';
import { applyAgentToken } from './streaming';
import { Message } from '@ai-conv/types';

describe('applyAgentToken — concurrent multi-agent streaming', () => {
  const now = () => '2026-01-01T00:00:00.000Z';

  it('creates separate messages for two agents streaming simultaneously', () => {
    let messages: Message[] = [];

    // Agent A sends token to message "msg-a"
    messages = applyAgentToken(messages, {
      conversationId: 'c1',
      messageId: 'msg-a',
      agentId: 'agent-a',
      agentName: 'Alice',
      token: 'Hello',
      isDone: false,
    }, now);

    // Agent B sends token to message "msg-b"
    messages = applyAgentToken(messages, {
      conversationId: 'c1',
      messageId: 'msg-b',
      agentId: 'agent-b',
      agentName: 'Bob',
      token: 'Hi',
      isDone: false,
    }, now);

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('msg-a');
    expect(messages[0].content).toBe('Hello');
    expect(messages[0].agentId).toBe('agent-a');
    expect(messages[1].id).toBe('msg-b');
    expect(messages[1].content).toBe('Hi');
    expect(messages[1].agentId).toBe('agent-b');
  });

  it('appends tokens to the correct message when two agents stream concurrently', () => {
    let messages: Message[] = [];

    // Interleave tokens from two agents
    const tokens = [
      { msgId: 'msg-a', token: 'He' },
      { msgId: 'msg-b', token: 'Hi' },
      { msgId: 'msg-a', token: 'llo' },
      { msgId: 'msg-b', token: ' there' },
    ];

    for (const t of tokens) {
      messages = applyAgentToken(messages, {
        conversationId: 'c1',
        messageId: t.msgId,
        agentId: t.msgId === 'msg-a' ? 'agent-a' : 'agent-b',
        agentName: t.msgId === 'msg-a' ? 'Alice' : 'Bob',
        token: t.token,
        isDone: false,
      }, now);
    }

    expect(messages).toHaveLength(2);
    const alice = messages.find(m => m.id === 'msg-a')!;
    const bob = messages.find(m => m.id === 'msg-b')!;
    expect(alice.content).toBe('Hello');
    expect(bob.content).toBe('Hi there');
  });

  it('creates messages with correct conversationId and role', () => {
    const result = applyAgentToken([], {
      conversationId: 'conv-42',
      messageId: 'msg-1',
      agentId: 'agent-x',
      agentName: 'X',
      token: 'test',
      isDone: false,
    }, now);

    expect(result[0].conversationId).toBe('conv-42');
    expect(result[0].role).toBe('agent');
    expect(result[0].isStreaming).toBe(true);
  });

  it('does not create duplicate messages for the same messageId', () => {
    let messages: Message[] = [];

    for (let i = 0; i < 5; i++) {
      messages = applyAgentToken(messages, {
        conversationId: 'c1',
        messageId: 'msg-a',
        agentId: 'agent-a',
        agentName: 'Alice',
        token: `${i}`,
        isDone: false,
      }, now);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('01234');
  });
});
