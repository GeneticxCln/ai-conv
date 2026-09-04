import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona, Message } from '@ai-conv/types';
import type { Server } from 'socket.io';

// ── Mock streamChat ───────────────────────────────────────────────
// We mock the ollama module so no real LLM is needed.
vi.mock('../llm/ollama.js', () => ({
  streamChat: vi.fn(),
  ensureModel: vi.fn(),
}));

import { streamChat } from '../llm/ollama.js';
import { BaseAgent } from './base';
import { parseToolCalls } from './toolEnabledDefault';

const mockedStreamChat = vi.mocked(streamChat);

// ── Test helpers ──────────────────────────────────────────────────
const persona: Persona = {
  id: 'agent-1',
  name: 'TestBot',
  model: 'test-model:latest',
  systemPrompt: 'You are a test bot.',
  temperature: 0.5,
  enabled: true,
};

const history: Message[] = [
  {
    id: 'h1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'Hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    isStreaming: false,
  },
];

/** Minimal concrete subclass for testing the abstract BaseAgent. */
class TestAgent extends BaseAgent {
  async handleUserMessage() {}
  async handleContinue() {}
}

/** Create a mock Socket.io Server that captures emitted events. */
function createMockIO() {
  const emitted: Array<{ room: string; event: string; payload: any }> = [];
  const emitFn = vi.fn((_event: string, _payload: any) => {});
  const toFn = vi.fn((_room: string) => ({ emit: emitFn }));

  return {
    io: { to: toFn } as unknown as Server,
    emitted,
    getEmitCalls: () => {
      // retroactively capture what to().emit() was called with
      return emitFn.mock.calls.map(([event, payload]) => ({ event, payload }));
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────
describe('BaseAgent.streamResponse', () => {
  let mockIO: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIO = createMockIO();
  });

  it('emits agent:token with the provided messageId', async () => {
    // Mock streamChat to yield two chunks
    async function* fakeStream() {
      yield { token: 'Hello', done: false };
      yield { token: ' world', done: true };
    }
    mockedStreamChat.mockReturnValue(fakeStream());

    const agent = new TestAgent(persona, mockIO.io);
    const gen = agent.streamResponse(
      'conv-1',
      history,
      'Hi',
      undefined,
      'msg-123' // <-- the messageId we want in every token
    );

    // consume the generator
    const chunks = [];
    for await (const chunk of gen) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ token: 'Hello', done: false });
    expect(chunks[1]).toEqual({ token: ' world', done: true });

    // Verify io.to().emit was called with the correct messageId
    expect(mockIO.io.to).toHaveBeenCalledWith('conv-1');
    const emitCalls = mockIO.getEmitCalls();
    expect(emitCalls).toHaveLength(2);
    expect(emitCalls[0].event).toBe('agent:token');
    expect(emitCalls[0].payload.messageId).toBe('msg-123');
    expect(emitCalls[0].payload.agentId).toBe('agent-1');
    expect(emitCalls[0].payload.agentName).toBe('TestBot');
    expect(emitCalls[1].payload.messageId).toBe('msg-123');
  });

  it('falls back to empty messageId when none is provided', async () => {
    async function* fakeStream() {
      yield { token: 'Hi', done: false };
    }
    mockedStreamChat.mockReturnValue(fakeStream());

    const agent = new TestAgent(persona, mockIO.io);
    const gen = agent.streamResponse('conv-1', history, 'Hey');
    for await (const _chunk of gen) { /* consume */ }

    const emitCalls = mockIO.getEmitCalls();
    expect(emitCalls[0].payload.messageId).toBe('');
  });

  it('prepends the system prompt to messages sent to streamChat', async () => {
    async function* fakeStream() {
      yield { token: 'ok', done: false };
    }
    mockedStreamChat.mockReturnValue(fakeStream());

    const agent = new TestAgent(persona, mockIO.io);
    const gen = agent.streamResponse('conv-1', history, 'test', undefined, 'm1');
    for await (const _chunk of gen) { /* consume */ }

    // streamChat should have been called with system prompt prepended
    const [, messages] = mockedStreamChat.mock.calls[0];
    expect(messages[0]).toEqual({ role: 'system', content: 'You are a test bot.' });
    // user message should be last
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'test' });
  });

  it('includes agent identity in every token payload', async () => {
    async function* fakeStream() {
      yield { token: 'A', done: false };
      yield { token: 'B', done: false };
      yield { token: 'C', done: true };
    }
    mockedStreamChat.mockReturnValue(fakeStream());

    const agent = new TestAgent(persona, mockIO.io);
    const gen = agent.streamResponse('conv-1', history, '', undefined, 'msg-x');
    for await (const _chunk of gen) { /* consume */ }

    const emitCalls = mockIO.getEmitCalls();
    for (const call of emitCalls) {
      expect(call.payload.agentId).toBe('agent-1');
      expect(call.payload.agentName).toBe('TestBot');
      expect(call.payload.conversationId).toBe('conv-1');
    }
  });

  it('streamChat is called with the correct persona model and temperature', async () => {
    async function* fakeStream() {
      yield { token: 'ok', done: true };
    }
    mockedStreamChat.mockReturnValue(fakeStream());

    const agent = new TestAgent(persona, mockIO.io);
    const gen = agent.streamResponse('conv-1', history, 'test', undefined, 'm1');
    for await (const _chunk of gen) { /* consume */ }

    const [usedPersona] = mockedStreamChat.mock.calls[0];
    expect(usedPersona.model).toBe('test-model:latest');
    expect(usedPersona.temperature).toBe(0.5);
  });
});

describe('parseToolCalls', () => {
  it('parses raw JSON tool_calls block', () => {
    const raw = '{"tool_calls": [{"name": "calculator", "arguments": {"expr": "2+2"}}]}';
    const parsed = parseToolCalls(raw);
    expect(parsed).toEqual([{ name: 'calculator', arguments: { expr: '2+2' } }]);
  });

  it('parses markdown json code block with tool_calls', () => {
    const raw = '```json\n{"tool_calls": [{"name": "current_datetime", "arguments": {}}]}\n```';
    const parsed = parseToolCalls(raw);
    expect(parsed).toEqual([{ name: 'current_datetime', arguments: {} }]);
  });

  it('returns null for normal conversational text', () => {
    const raw = 'Hello! I am a helpful AI assistant. How can I help you today?';
    expect(parseToolCalls(raw)).toBeNull();
  });
});
