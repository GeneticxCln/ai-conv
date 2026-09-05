import { describe, expect, it } from 'vitest';
import { parseNvidiaSmiOutput } from './gpuInfo';

describe('parseNvidiaSmiOutput', () => {
  it('parses a single GPU line (name, total, used in MiB)', () => {
    expect(parseNvidiaSmiOutput('NVIDIA GeForce RTX 4060 Ti, 16380, 15264')).toEqual({
      available: true,
      name: 'NVIDIA GeForce RTX 4060 Ti',
      totalMiB: 16380,
      usedMiB: 15264,
    });
  });

  it('uses the first GPU on multi-GPU hosts', () => {
    const out = [
      'NVIDIA GeForce RTX 4060 Ti, 16380, 15264',
      'NVIDIA GeForce RTX 3090, 24576, 100',
    ].join('\n');
    expect(parseNvidiaSmiOutput(out).name).toBe('NVIDIA GeForce RTX 4060 Ti');
    expect(parseNvidiaSmiOutput(out).totalMiB).toBe(16380);
  });

  it('reports unavailable for empty or garbage output', () => {
    expect(parseNvidiaSmiOutput('')).toEqual({ available: false });
    expect(parseNvidiaSmiOutput('no gpu info here')).toEqual({ available: false });
    expect(parseNvidiaSmiOutput('GPU,,notnum')).toEqual({ available: false });
  });
});
