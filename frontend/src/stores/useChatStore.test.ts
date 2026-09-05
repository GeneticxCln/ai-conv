import { beforeEach, describe, it, expect, vi } from 'vitest';

// zustand persist captures `localStorage` at module load; stub before import.
const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, v),
  removeItem: (k: string) => void backing.delete(k),
});

// Static import cannot work here: the store must load AFTER the localStorage
// stub exists (see comment above).
const { useChatStore } = await import('./useChatStore');
import type { Conversation, Message, Persona } from '@ai-conv/types';

const conv = (id: string): Conversation => ({
  id,
  title: `Conv ${id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const msg = (id: string, conversationId: string, content = 'hi'): Message => ({
  id,
  conversationId,
  role: 'user',
  content,
  createdAt: '2026-01-01T00:00:00.000Z',
  isStreaming: false,
});

const persona = (id: string, enabled = true): Persona => ({
  id,
  name: `P ${id}`,
  model: 'llama3',
  systemPrompt: 'be brief',
  temperature: 0.7,
  enabled,
  enabledTools: false,
});

describe('useChatStore reducers', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      messages: {},
      currentConversationId: null,
      agents: [],
      streamingMessages: {},
    });
  });

  it('removeConversation drops its messages and reselects the first remaining', () => {
    useChatStore.setState({
      conversations: [conv('a'), conv('b')],
      currentConversationId: 'a',
      messages: { a: [msg('m1', 'a')], b: [msg('m2', 'b')] },
    });

    useChatStore.getState().removeConversation('a');

    const s = useChatStore.getState();
    expect(s.conversations.map((c) => c.id)).toEqual(['b']);
    expect(s.messages['a']).toBeUndefined();
    expect(s.currentConversationId).toBe('b');
  });

  it('clearAllConversations empties conversations, messages and selection', () => {
    useChatStore.setState({ conversations: [conv('a')], currentConversationId: 'a', messages: { a: [msg('m1', 'a')] } });

    useChatStore.getState().clearAllConversations();

    const s = useChatStore.getState();
    expect(s.conversations).toEqual([]);
    expect(s.messages).toEqual({});
    expect(s.currentConversationId).toBeNull();
  });

  it('updateMessage patches only the targeted message', () => {
    useChatStore.setState({ messages: { a: [msg('m1', 'a'), msg('m2', 'a')] } });

    useChatStore.getState().updateMessage('a', 'm2', { content: 'updated' });

    const list = useChatStore.getState().messages['a'];
    expect(list[0].content).toBe('hi');
    expect(list[1].content).toBe('updated');
  });

  it('toggleAgent flips only the given persona', () => {
    useChatStore.setState({ agents: [persona('p1'), persona('p2', false)] });

    useChatStore.getState().toggleAgent('p2');

    const agents = useChatStore.getState().agents;
    expect(agents.find((a) => a.id === 'p1')?.enabled).toBe(true);
    expect(agents.find((a) => a.id === 'p2')?.enabled).toBe(true);
  });

  it('startStreaming/stopStreaming track and clear streaming ids', () => {
    useChatStore.getState().startStreaming('m9', 'agent-1');
    expect(useChatStore.getState().streamingMessages['m9']).toBe('agent-1');

    useChatStore.getState().stopStreaming('m9');
    expect(useChatStore.getState().streamingMessages['m9']).toBeUndefined();
  });

  it('setAwaitingFirstToken tracks per conversation and clears independently', () => {
    useChatStore.getState().setAwaitingFirstToken('conv-a', true);
    useChatStore.getState().setAwaitingFirstToken('conv-b', true);
    expect(useChatStore.getState().awaitingFirstToken['conv-a']).toBe(true);
    expect(useChatStore.getState().awaitingFirstToken['conv-b']).toBe(true);

    // First token arrives for conv-a only.
    useChatStore.getState().setAwaitingFirstToken('conv-a', false);
    expect(useChatStore.getState().awaitingFirstToken['conv-a']).toBeUndefined();
    expect(useChatStore.getState().awaitingFirstToken['conv-b']).toBe(true);

    // Idempotent clear.
    useChatStore.getState().setAwaitingFirstToken('conv-a', false);
    expect(useChatStore.getState().awaitingFirstToken['conv-a']).toBeUndefined();
  });
});
