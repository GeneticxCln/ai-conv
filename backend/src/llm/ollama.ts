import { Ollama } from 'ollama';
import { Persona } from '@ai-conv/types';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

export const ollama = new Ollama({ host: OLLAMA_HOST });

// ============ Types ============
export interface StreamChunk {
  token: string;
  done: boolean;
  /** Non-empty when streamChat encounters a non-AbortError failure. */
  error?: string;
}

export interface ModelInfo {
  name: string;
  size: number;
  modifiedAt?: string;
  digest: string;
  details?: {
    format: string;
    family: string;
    families: string[];
    parameterSize?: string;
    quantizationLevel?: string;
  };
}

export interface ValidateModelResult {
  valid: boolean;
  model?: ModelInfo;
  error?: string;
  availableModels: string[];
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

/**
 * Validate that a model name exists in the local Ollama installation.
 * Returns the model info if valid, or an error with list of available models.
 */
export async function validateModel(model: string): Promise<ValidateModelResult> {
  try {
    const { models } = await ollama.list();
    const availableModels = models.map(m => m.name);

    // Check exact match first
    const exactMatch = models.find(m => m.name === model);
    if (exactMatch) {
      return { valid: true, model: exactMatch as unknown as ModelInfo, availableModels };
    }

    // Check prefix match (e.g., "llama3.1" matches "llama3.1:8b")
    const prefixMatch = models.find(m => m.name.startsWith(model + ':'));
    if (prefixMatch) {
      return { valid: true, model: prefixMatch as unknown as ModelInfo, availableModels };
    }

    // No match found
    return {
      valid: false,
      error: `Model "${model}" not found in Ollama. Available: ${availableModels.join(', ') || 'none'}`,
      availableModels,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      error: `Failed to validate model: ${msg}`,
      availableModels: [],
    };
  }
}

/**
 * Pick the first installed model that supports chat completion.
 *
 * `ollama.list()` also returns embedding-only models (for example
 * nomic-embed-text) in no guaranteed order, so using models[0] to
 * auto-detect a persona model can produce a persona that can never reply.
 * Capabilities are only exposed by `show()`. Models that report no
 * capabilities (older Ollama servers) are assumed to be chat-capable.
 */
export async function findChatModel(): Promise<string | null> {
  try {
    const { models } = await ollama.list();
    let fallback: string | null = null;

    for (const listed of models) {
      fallback ??= listed.name;
      try {
        const { capabilities } = await ollama.show({ model: listed.name });
        if (!capabilities || capabilities.length === 0 || capabilities.includes('completion')) {
          return listed.name;
        }
      } catch {
        // show() is unavailable on some older servers — use the first tag.
        return fallback;
      }
    }

    return fallback;
  } catch {
    return null;
  }
}

/**
 * Get list of all installed models.
 */
export async function listModels(): Promise<string[]> {
  try {
    const { models } = await ollama.list();
    return models.map(m => m.name);
  } catch {
    return [];
  }
}

// ============ Active Stream Registry (for stop generation) ============

const activeStreams = new Map<string, AbortController>();

export function registerStream(key: string): AbortController {
  const controller = new AbortController();
  activeStreams.set(key, controller);
  return controller;
}

export function releaseStream(key: string): void {
  activeStreams.delete(key);
}

export function abortStreamsForConversation(conversationId: string): void {
  for (const [key, controller] of activeStreams.entries()) {
    if (key.startsWith(conversationId + ':')) {
      controller.abort();
      activeStreams.delete(key);
    }
  }
}

// ============ Streaming Chat ============

/**
 * Yielded by streamChat when an error occurs.  Callers can check
 * `chunk.error` to distinguish between successful completion and
 * failure — previously a silent `done: true` hid errors from callers.
 */
export interface StreamChunk {
  token: string;
  done: boolean;
  error?: string;
}

export async function* streamChat(
  persona: Persona,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  try {
    console.log('[streamChat] Calling ollama.chat for model:', persona.model, 'messages:', messages.length);
    const response = await ollama.chat({
      model: persona.model,
      messages,
      stream: true,
      think: false,
      options: {
        temperature: persona.temperature,
      },
    });
    console.log('[streamChat] Got response, iterating chunks...');

    const abortErr = (): Error => {
      const e = new Error('Aborted');
      e.name = 'AbortError';
      return e;
    };

    // Stop DURING model load: the ollama client only resolves chat() after
    // the server has loaded the model, which can take minutes for large
    // models. If the user hit Stop in that window, cancel the underlying
    // HTTP request immediately instead of waiting for the first chunk.
    if (signal?.aborted) {
      try { (response as { abort?: () => void }).abort?.(); } catch { /* ignore */ }
      throw abortErr();
    }

    const onAbort = () => {
      try { response.abort(); } catch { /* ignore */ }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      for await (const chunk of response) {
        console.log('[streamChat] Chunk:', JSON.stringify(chunk).slice(0, 100));
        if (signal?.aborted) {
          response.abort();
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        if (chunk.message?.content) {
          yield { token: chunk.message.content, done: false };
        }
      }
      console.log('[streamChat] Stream complete');
      yield { token: '', done: true };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  } catch (error) {
    console.error('[streamChat] Error caught:', error);
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[streamChat] Stream chat error:', errMsg);
    yield { token: '', done: true, error: errMsg };
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
