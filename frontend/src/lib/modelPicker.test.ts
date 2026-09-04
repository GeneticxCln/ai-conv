import { describe, it, expect } from 'vitest';
import { isEmbeddingModel, parseParameterSize, pickFastestChatModel, compareModelsBySpeed, sortModelsBySpeed, InstalledModel } from './modelPicker';

const model = (
  name: string,
  size: number,
  parameterSize?: string,
  capabilities?: string[],
): InstalledModel => ({
  name,
  size,
  ...(parameterSize ? { parameterSize } : {}),
  ...(capabilities ? { capabilities } : {}),
});

describe('parseParameterSize', () => {
  it('parses B-suffixed sizes', () => {
    expect(parseParameterSize('1.24B')).toBeCloseTo(1.24);
    expect(parseParameterSize('27.3B')).toBeCloseTo(27.3);
    expect(parseParameterSize('756b')).toBe(756);
    expect(parseParameterSize('7')).toBe(7);
  });

  it('normalizes megaparam sizes to billions', () => {
    // Ollama reports sub-1B models in megaparams; without normalization a
    // 494.03M model would rank ABOVE a 1.24B one.
    expect(parseParameterSize('494.03M')).toBeCloseTo(0.494);
    expect(parseParameterSize('137M')).toBeCloseTo(0.137);
    expect(parseParameterSize('568M')).toBeCloseTo(0.568);
  });

  it('normalizes kiloparam sizes to billions', () => {
    expect(parseParameterSize('500K')).toBeCloseTo(0.0005);
  });

  it('returns NaN for missing or unparseable values', () => {
    expect(parseParameterSize(undefined)).toBeNaN();
    expect(parseParameterSize('')).toBeNaN();
    expect(parseParameterSize('unknown')).toBeNaN();
  });
});

describe('isEmbeddingModel', () => {
  it('detects embedding models by capability', () => {
    expect(isEmbeddingModel(model('bge-m3', 1000, '568M', ['embedding']))).toBe(true);
    expect(isEmbeddingModel(model('nomic-embed-text:latest', 274_302_450, '137M', ['embedding']))).toBe(true);
    expect(isEmbeddingModel(model('llama3.1:8b', 4_700_000_000, '8.0B', ['completion']))).toBe(false);
  });

  it('falls back to the name heuristic when capabilities are missing', () => {
    expect(isEmbeddingModel(model('nomic-embed-text:latest', 274_302_450, '137M'))).toBe(true);
    expect(isEmbeddingModel(model('llama3.1:8b', 4_700_000_000, '8.0B'))).toBe(false);
  });
});

describe('pickFastestChatModel', () => {
  it('picks the smallest chat model, excluding embedding models', () => {
    const models = [
      model('qwen3.8:27b', 17_741_872_154, '27.3B', ['completion']),
      model('nomic-embed-text:latest', 274_302_450, '137M', ['embedding']),
      model('DOLPHIN3.0-1B:latest', 743_145_283, '1.24B', ['completion']),
      model('gemma4:latest', 9_608_350_718, '8.0B', ['completion']),
    ];
    expect(pickFastestChatModel(models)?.name).toBe('DOLPHIN3.0-1B:latest');
  });

  it('ranks models with unknown parameter size after known ones, by file size', () => {
    const models = [
      model('big-unknown:latest', 20_000_000_000),
      model('llama3.1:8b', 4_700_000_000, '8.0B'),
      model('small-unknown:latest', 500_000_000),
    ];
    expect(pickFastestChatModel(models)?.name).toBe('llama3.1:8b');
  });

  it('prefers a 0.5B model over a 1B model (M vs B units)', () => {
    const models = [
      model('qwen2.5:0.5b', 397_000_000, '494.03M', ['completion']),
      model('DOLPHIN3.0-1B:latest', 743_145_283, '1.24B', ['completion']),
      model('llama3.1:8b', 4_700_000_000, '8.0B', ['completion']),
    ];
    expect(pickFastestChatModel(models)?.name).toBe('qwen2.5:0.5b');
  });

  it('ranks quantization-suffixed models by parameter size, not by name', () => {
    const models = [
      model('qwen2.5:7b-instruct-q4_K_M', 4_700_000_000, '7.0B', ['completion']),
      model('mistral:7b-instruct-q2_K', 3_200_000_000, '7.0B', ['completion']),
      model('llama3.1:8b', 4_700_000_000, '8.0B', ['completion']),
      model('qwen3.8:27b', 17_741_872_154, '27.3B', ['completion']),
    ];
    // Both quantized 7B models beat the 8B/27B; the identical 7.0B params
    // tie-break by file size (Q2 is smaller than Q4).
    expect(pickFastestChatModel(models)?.name).toBe('mistral:7b-instruct-q2_K');
  });

  it('tie-breaks identical parameter sizes by file size', () => {
    const models = [
      model('llama3:8b-q8_0', 8_100_000_000, '8.0B', ['completion']),
      model('llama3:8b-q4_0', 4_700_000_000, '8.0B', ['completion']),
      model('llama3:8b-q2_K', 3_100_000_000, '8.0B', ['completion']),
    ];
    expect(pickFastestChatModel(models)?.name).toBe('llama3:8b-q2_K');
  });

  it('ranks quantization-named models without parameterSize after known ones', () => {
    const models = [
      model('qwen2.5:7b-instruct-q4_K_M', 4_700_000_000),
      model('dolphin-1b:latest', 743_145_283, '1.24B', ['completion']),
    ];
    expect(pickFastestChatModel(models)?.name).toBe('dolphin-1b:latest');
  });

  it('falls back to file size when every model lacks a parameter size', () => {
    const models = [
      model('huge:latest', 30_000_000_000),
      model('tiny:latest', 400_000_000),
    ];
    expect(pickFastestChatModel(models)?.name).toBe('tiny:latest');
  });

  it('returns undefined when there are no chat models', () => {
    expect(pickFastestChatModel([model('nomic-embed-text:latest', 274_302_450, '137M', ['embedding'])])).toBeUndefined();
    expect(pickFastestChatModel([])).toBeUndefined();
  });

  it('never picks cloud stub models with absurd parameter sizes', () => {
    const models = [
      model('glm-5.2:cloud', 338, '756b'),
      model('dolphin-1b:latest', 743_145_283, '1.24B'),
    ];
    expect(pickFastestChatModel(models)?.name).toBe('dolphin-1b:latest');
  });
});

describe('compareModelsBySpeed', () => {
  it('sorts smallest parameter size first, embedding models included', () => {
    const models = [
      model('qwen3.8:27b', 17_741_872_154, '27.3B', ['completion']),
      model('nomic-embed-text:latest', 274_302_450, '137M', ['embedding']),
      model('DOLPHIN3.0-1B:latest', 743_145_283, '1.24B', ['completion']),
      model('gemma4:latest', 9_608_350_718, '8.0B', ['completion']),
    ];
    const names = [...models].sort(compareModelsBySpeed).map((m) => m.name);
    expect(names).toEqual([
      'nomic-embed-text:latest', // 0.137B — embeddings sort by size too
      'DOLPHIN3.0-1B:latest',
      'gemma4:latest',
      'qwen3.8:27b',
    ]);
  });

  it('ranks models without a parameter size last, by file size', () => {
    const models = [
      model('big-unknown:latest', 20_000_000_000),
      model('small-unknown:latest', 500_000_000),
      model('llama3.1:8b', 4_700_000_000, '8.0B'),
    ];
    const names = [...models].sort(compareModelsBySpeed).map((m) => m.name);
    expect(names).toEqual(['llama3.1:8b', 'small-unknown:latest', 'big-unknown:latest']);
  });

  it('tie-breaks identical parameter sizes by file size', () => {
    const a = model('llama3:8b-q8_0', 8_100_000_000, '8.0B');
    const b = model('llama3:8b-q4_0', 4_700_000_000, '8.0B');
    expect(compareModelsBySpeed(b, a)).toBeLessThan(0);
    expect(compareModelsBySpeed(a, b)).toBeGreaterThan(0);
    expect(compareModelsBySpeed(a, a)).toBe(0);
  });
});

describe('sortModelsBySpeed', () => {
  it('returns a sorted copy without mutating the input', () => {
    const input = [
      model('qwen3.8:27b', 17_741_872_154, '27.3B'),
      model('DOLPHIN3.0-1B:latest', 743_145_283, '1.24B'),
    ];
    const sorted = sortModelsBySpeed(input);
    expect(sorted.map((m) => m.name)).toEqual(['DOLPHIN3.0-1B:latest', 'qwen3.8:27b']);
    // Input array unchanged.
    expect(input.map((m) => m.name)).toEqual(['qwen3.8:27b', 'DOLPHIN3.0-1B:latest']);
  });
});
