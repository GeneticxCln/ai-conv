import { execFile } from 'child_process';

export interface GpuInfo {
  available: boolean;
  name?: string;
  totalMiB?: number;
  usedMiB?: number;
}

/**
 * Parse `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` output.
 * One GPU per line: "NVIDIA GeForce RTX 4060 Ti, 16380, 15264".
 * The FIRST line wins (multi-GPU hosts: the primary card is the one Ollama
 * uses first). Unparseable output yields { available: false }.
 */
export function parseNvidiaSmiOutput(text: string): GpuInfo {
  const line = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return { available: false };

  const [name, total, used] = line.split(',').map((s) => s.trim());
  const totalMiB = Number.parseInt(total, 10);
  const usedMiB = Number.parseInt(used, 10);
  if (!name || !Number.isFinite(totalMiB) || !Number.isFinite(usedMiB)) {
    return { available: false };
  }
  return { available: true, name, totalMiB, usedMiB };
}

let cache: { at: number; info: GpuInfo } | null = null;
const CACHE_MS = 60_000;

/**
 * Best-effort GPU memory report for the machine running Ollama. Returns
 * { available: false } when nvidia-smi is missing, times out, or fails —
 * callers must treat that as "cannot assess" and stay silent.
 * Cached for a minute: VRAM usage changes slowly and spawning nvidia-smi on
 * every modal open is wasteful.
 */
export async function getGpuInfo(): Promise<GpuInfo> {
  // Test hook: deterministic GPU report for E2E runs on machines with no
  // (or a different) GPU. Set AICONV_FAKE_GPU_TOTAL_MIB to activate.
  const fakeTotal = Number.parseInt(process.env.AICONV_FAKE_GPU_TOTAL_MIB || '', 10);
  if (Number.isFinite(fakeTotal) && fakeTotal > 0) {
    const fakeUsed = Number.parseInt(process.env.AICONV_FAKE_GPU_USED_MIB || '', 10);
    return {
      available: true,
      name: process.env.AICONV_FAKE_GPU_NAME || 'Fake GPU (AICONV_FAKE_GPU)',
      totalMiB: fakeTotal,
      usedMiB: Number.isFinite(fakeUsed) && fakeUsed >= 0 ? fakeUsed : 0,
    };
  }

  if (cache && Date.now() - cache.at < CACHE_MS) return cache.info;

  const info = await new Promise<GpuInfo>((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'],
      { timeout: 3000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({ available: false });
          return;
        }
        resolve(parseNvidiaSmiOutput(String(stdout)));
      },
    );
  });

  cache = { at: Date.now(), info };
  return info;
}
