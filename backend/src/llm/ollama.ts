import { Ollama } from 'ollama';
import { Persona } from '../types';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

export const ollama = new Ollama({ host: OLLAMA_HOST });

// ============ Types ============
export interface StreamChunk {
  token: string;
  done: boolean;
}

// ============ Model Management ============
export async function ensureModel(model: string): Promise<void> {
  try {
    const { models } = await ollama.list();
    const exists = models.some(m => m.name === model || m.name.startsWith(model + ':'));
    if (!exists) {
      console.log(`Pulling model: ${model}`);
      await ollama.pull({ model, stream: false });
      console.log(`Model ${model} ready`);
    }
  } catch (error) {
    console.error(`Failed to ensure model ${model}:`, error);
    throw error;
  }
}

// ============ Active Stream Registry (for stop generation) ============
const activeStreams = new Map<string, AbortController>();

export function registerStream(key: string): AbortController {
  const controller = new AbortController();
  activeStreams.set(key, controller);
  return controller;
}

export function releaseStream(key: string) {
  activeStreams.delete(key);
}

export function abortStreamsForConversation(conversationId: string): number {
  let n = 0;
  for (const [key, controller] of activeStreams) {
    if (key.startsWith(conversationId + ':')) {
      controller.abort();
      activeStreams.delete(key);
      n++;
    }
  }
  return n;
}

// ============ Streaming Chat ============
export async function* streamChat(
  persona: Persona,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  await ensureModel(persona.model);

  const stream = await ollama.chat({
    model: persona.model,
    messages: [
      { role: 'system', content: persona.systemPrompt },
      ...messages,
    ],
    stream: true,
    options: { temperature: persona.temperature },
    signal,
  } as any);

  for await (const chunk of stream) {
    if (chunk.message?.content) {
      yield { token: chunk.message.content, done: chunk.done || false };
    }
  }
}

// ============ Health Check ============
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    await ollama.list();
    return true;
  } catch {
    return false;
  }
}
