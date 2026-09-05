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

  it('aborts the request when the signal is already aborted (stop during model load)', async () => {
    // ollama's chat() resolves to an AbortableAsyncIterator only AFTER the
    // model finishes loading. Simulate "already aborted while waiting for
    // load": the request must be cancelled immediately, not after the first
    // chunk arrives.
    const abortMock = vi.fn();
    chatMock.mockResolvedValue({
      abort: abortMock,
      [Symbol.asyncIterator]: async function* () {
        yield { message: { content: 'too late' }, done: false };
      },
    });

    const controller = new AbortController();
    controller.abort();

    await expect(async () => {
      for await (const chunk of streamChat(persona, [{ role: 'user', content: 'hi' }], controller.signal)) {
        void chunk;
      }
    }).rejects.toMatchObject({ name: 'AbortError' });

    expect(abortMock).toHaveBeenCalled();
  });

  it('aborts mid-stream when the signal fires between chunks', async () => {
    const abortMock = vi.fn();
    async function* response() {
      yield { message: { content: 'part' }, done: false };
      yield { message: { content: ' never arrives' }, done: false };
    }
    // Attach an abort method to the returned generator, like the real client.
    const gen = response();
    (gen as { abort?: () => void }).abort = abortMock;
    chatMock.mockResolvedValue(gen);

    const controller = new AbortController();
    const chunks = [];
    await expect(async () => {
      for await (const chunk of streamChat(persona, [{ role: 'user', content: 'hi' }], controller.signal)) {
        chunks.push(chunk);
        controller.abort(); // fire after first chunk
      }
    }).rejects.toMatchObject({ name: 'AbortError' });

    expect(abortMock).toHaveBeenCalled();
    expect(chunks).toEqual([{ token: 'part', done: false }]);
  });
});
