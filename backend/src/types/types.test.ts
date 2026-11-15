import { describe, it, expect } from 'vitest';
import { PersonaSchema, UserMessagePayloadSchema, AgentTokenPayloadSchema } from './index';

describe('PersonaSchema', () => {
  it('accepts a valid persona with defaults', () => {
    const p = PersonaSchema.parse({ id: 'nova', name: 'Nova', model: 'qwen3.8:27b', systemPrompt: 'hi' });
    expect(p.model).toBe('qwen3.8:27b');
    expect(p.enabled).toBe(true);
    expect(p.temperature).toBe(0.7);
  });

  it('rejects empty name', () => {
    expect(() => PersonaSchema.parse({ id: 'x', name: '', systemPrompt: 'hi' })).toThrow();
  });
});

describe('UserMessagePayloadSchema', () => {
  it('requires conversationId and content', () => {
    const ok = UserMessagePayloadSchema.safeParse({ conversationId: '111e4567-e89b-12d3-a456-426614174000', content: 'hello', agentChat: true });
    expect(ok.success).toBe(true);
    const bad = UserMessagePayloadSchema.safeParse({ content: 'hello' });
    expect(bad.success).toBe(false);
  });

  it('rejects empty and whitespace-only content', () => {
    const conversationId = '111e4567-e89b-12d3-a456-426614174000';
    expect(UserMessagePayloadSchema.safeParse({ conversationId, content: '' }).success).toBe(false);
    expect(UserMessagePayloadSchema.safeParse({ conversationId, content: '   \n ' }).success).toBe(false);
    expect(UserMessagePayloadSchema.safeParse({ conversationId, content: ' hi ' }).success).toBe(true);
  });
});

describe('AgentTokenPayloadSchema', () => {
  it('routes agent identity in every token', () => {
    const ok = AgentTokenPayloadSchema.safeParse({
      conversationId: '111e4567-e89b-12d3-a456-426614174000',
      messageId: '222e4567-e89b-12d3-a456-426614174000',
      agentId: '333e4567-e89b-12d3-a456-426614174000',
      agentName: 'Nova',
      token: 'he',
      isDone: false,
    });
    expect(ok.success).toBe(true);
  });
});
