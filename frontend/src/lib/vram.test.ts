import { describe, expect, it } from 'vitest';
import { vramWarning, modelSizeMiB, modelFitsInVram } from './vram';
import { InstalledModel } from './modelPicker';

const model = (sizeBytes: number): InstalledModel => ({ name: 'm', size: sizeBytes });

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe('modelSizeMiB', () => {
  it('converts bytes to MiB', () => {
    expect(modelSizeMiB(GIB)).toBe(1024);
    expect(modelSizeMiB(0)).toBe(0);
  });
});

describe('vramWarning', () => {
  const gpu = { available: true, name: 'RTX 4060 Ti', totalMiB: 16384, usedMiB: 2743 };

  it('returns null when everything fits in free VRAM', () => {
    // 965 MB model + 1 GiB overhead ≈ 1989 MiB < 13641 free
    expect(vramWarning(model(965 * MIB), gpu)).toBeNull();
  });

  it('errors when the model exceeds TOTAL VRAM (guaranteed CPU offload)', () => {
    const warn = vramWarning(model(17 * GIB), gpu);
    expect(warn?.level).toBe('error');
    expect(warn?.message).toContain('larger than your GPU');
    expect(warn?.message).toContain('RTX 4060 Ti');
  });

  it('warns when the model fits total but not FREE VRAM (busy GPU)', () => {
    const busy = { ...gpu, usedMiB: 15264 }; // 1.1 GiB free
    const warn = vramWarning(model(17 * GIB), busy);
    expect(warn?.level).toBe('error'); // 17 GiB still exceeds total

    const mid = vramWarning(model(14 * GIB), busy); // 15 GiB need > 16 total? no: 14GiB+1GiB=15GiB <16 total, >1.1 free
    expect(mid?.level).toBe('warning');
    expect(mid?.message).toContain('Only');
    expect(mid?.message).toContain('ollama stop');
  });

  it('stays silent when the GPU report is unavailable or model size unknown', () => {
    expect(vramWarning(model(GIB), null)).toBeNull();
    expect(vramWarning(model(GIB), { available: false })).toBeNull();
    expect(vramWarning({ name: 'm', size: 0 }, gpu)).toBeNull();
    expect(vramWarning(undefined, gpu)).toBeNull();
  });
});

describe('modelFitsInVram', () => {
  const gpu = { available: true, name: 'RTX 4060 Ti', totalMiB: 16384, usedMiB: 2743 };

  it('true when the model plus overhead fits total VRAM', () => {
    expect(modelFitsInVram(model(14 * GIB), gpu)).toBe(true); // 14 GiB + 1 GiB = 15 GiB ≤ 16
  });

  it('false when the model plus overhead exceeds total VRAM', () => {
    expect(modelFitsInVram(model(17 * GIB), gpu)).toBe(false); // 17 GiB + 1 GiB = 18 GiB > 16
  });

  it('defaults to true (silent) when assessment is impossible', () => {
    expect(modelFitsInVram(model(GIB), { available: false })).toBe(true);
    expect(modelFitsInVram({ name: 'm', size: 0 }, gpu)).toBe(true);
    expect(modelFitsInVram(undefined as unknown as InstalledModel, gpu)).toBe(true);
  });
});
