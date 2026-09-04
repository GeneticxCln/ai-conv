import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Persona } from '@ai-conv/types';

const chatMock = vi.fn();

vi.mock('ollama', () => ({
  Ollama: class {
    chat = chatMock;
    list = vi.fn();
  },
}));

const { streamChat } = await import('./ollama');

const persona: Persona = {
  id: 'p1',
  name: 'TestBot',
  model: 'test-model:latest',
  systemPrompt: 'Answer briefly.',
  temperature: 0.2,
  enabled: true,
};

describe('streamChat', () => {
  beforeEach(() => chatMock.mockReset());

  it('disables hidden thinking so thinking models stream visible answers', async () => {
    async function* response() {
      yield { message: { content: 'OK' }, done: false };
      yield { message: { content: '' }, done: true };
    }
    chatMock.mockResolvedValue(response());

    const chunks = [];
    for await (const chunk of streamChat(persona, [{ role: 'user', content: 'Say OK' }])) {
      chunks.push(chunk);
    }

    expect(chatMock).toHaveBeenCalledWith(expect.objectContaining({
      model: persona.model,
      stream: true,
      think: false,
    }));
    expect(chunks).toEqual([
      { token: 'OK', done: false },
      { token: '', done: true },
    ]);
  });
});
