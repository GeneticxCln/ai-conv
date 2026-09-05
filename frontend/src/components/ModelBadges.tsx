import { Zap, AlertTriangle } from 'lucide-react';

// Green ⚡ badge shown next to the fastest installed chat model. Shared by the
// SettingsModal model list and the PersonaModal model dropdown so the label is
// always identical. The choice is computed from pickFastestChatModel — the same
// ranking the E2E global-setup uses.
export function FastestBadge() {
  return (
    <span
      data-testid="fastest-model-badge"
      title="Fastest installed chat model (fewest parameters) — the one the E2E suite picks"
      className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300"
    >
      <Zap className="w-2.5 h-2.5" />
      fastest
    </span>
  );
}

// Purple badge marking embedding-only models, which cannot chat.
export function EmbeddingBadge() {
  return (
    <span
      data-testid="embedding-model-badge"
      className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300"
    >
      embedding
    </span>
  );
}

// Red badge for models whose file (plus ~1 GiB runtime overhead) does not fit
// in the GPU's total VRAM — they are guaranteed to offload to CPU and crawl.
// Shown in the Settings model list per row; the PersonaModal shows the fuller
// explanatory warning text instead.
export function TooBigForVramBadge() {
  return (
    <span
      data-testid="too-big-for-vram-badge"
      title="Larger than the GPU's VRAM — will offload to CPU and respond extremely slowly"
      className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300"
    >
      <AlertTriangle className="w-2.5 h-2.5" />
      too big for VRAM
    </span>
  );
}