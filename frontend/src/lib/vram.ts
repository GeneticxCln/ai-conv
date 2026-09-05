import { InstalledModel } from './modelPicker';

export interface GpuInfo {
  available: boolean;
  name?: string;
  totalMiB?: number;
  usedMiB?: number;
}

export interface VramWarning {
  level: 'error' | 'warning';
  message: string;
}

const MIB = 1024 * 1024;
// Runtime overhead on top of the GGUF file: KV cache + compute buffers grow
// with context length. 1 GiB is a conservative floor for typical 4–8k
// context chat usage — without it a model exactly the size of the card would
// be reported as "fits" when it will not.
const RUNTIME_OVERHEAD_MIB = 1024;

export function modelSizeMiB(sizeBytes: number): number {
  return sizeBytes / MIB;
}

function fmt(miB: number): string {
  return miB >= 1024 ? `${(miB / 1024).toFixed(1)} GB` : `${Math.round(miB)} MB`;
}

/**
 * True when the model file (plus ~1 GiB runtime overhead) fits in the GPU's
 * TOTAL VRAM. Used for per-model tags in the Settings list; the PersonaModal
 * uses the richer vramWarning() for explanations.
 */
export function modelFitsInVram(model: InstalledModel, gpu: GpuInfo): boolean {
  if (!gpu?.available || !model) return true;
  if (!Number.isFinite(model.size) || model.size <= 0) return true;
  if (!Number.isFinite(gpu.totalMiB) || (gpu.totalMiB ?? 0) <= 0) return true;
  return modelSizeMiB(model.size) + RUNTIME_OVERHEAD_MIB <= (gpu.totalMiB as number);
}

/**
 * Decide whether the selected model will actually run well on the machine's
 * GPU. Returns null when we cannot assess (no GPU report, unknown model
 * size) — silence beats nagging on machines where Ollama runs CPU-only.
 *
 * - error:   model + runtime overhead cannot fit in TOTAL VRAM → guaranteed
 *            partial CPU offload, every token crawls.
 * - warning: fits in total but not in what is FREE right now → another model
 *            is hogging VRAM; this persona will crawl until it is unloaded.
 */
export function vramWarning(
  model: InstalledModel | undefined,
  gpu: GpuInfo | null | undefined,
): VramWarning | null {
  if (!gpu?.available || !model) return null;
  if (!Number.isFinite(model.size) || model.size <= 0) return null;
  if (!Number.isFinite(gpu.totalMiB) || (gpu.totalMiB ?? 0) <= 0) return null;

  const totalMiB = gpu.totalMiB as number;
  const needMiB = modelSizeMiB(model.size) + RUNTIME_OVERHEAD_MIB;

  if (needMiB > totalMiB) {
    return {
      level: 'error',
      message:
        `This ${fmt(modelSizeMiB(model.size))} model is larger than your GPU's ${fmt(totalMiB)} VRAM` +
        `${gpu.name ? ` (${gpu.name})` : ''} — it will offload to CPU and respond extremely slowly. ` +
        'Pick a smaller model for fast chat.',
    };
  }

  const usedMiB = Number.isFinite(gpu.usedMiB as number) ? (gpu.usedMiB as number) : 0;
  const freeMiB = Math.max(0, totalMiB - usedMiB);
  if (needMiB > freeMiB) {
    return {
      level: 'warning',
      message:
        `Only ${fmt(freeMiB)} of ${fmt(totalMiB)} VRAM is free — another model is probably still loaded. ` +
        'Run `ollama stop <model>` first, or this persona will crawl until VRAM frees up.',
    };
  }

  return null;
}
