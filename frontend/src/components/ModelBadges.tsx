import { Zap } from 'lucide-react';

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