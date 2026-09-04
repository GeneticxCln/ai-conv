// Metadata for an installed Ollama model, as returned by models:list:full.
export interface InstalledModel {
  name: string;
  size: number;
  parameterSize?: string;
  capabilities?: string[];
}

// An embedding model cannot chat. Ollama marks them with an "embedding"
// capability — trust that when present, and fall back to the name heuristic
// for Ollama versions that omit capabilities.
export function isEmbeddingModel(model: InstalledModel): boolean {
  if (model.capabilities?.includes('embedding')) return true;
  return /embed/i.test(model.name);
}

// Parse a parameter size into BILLIONS so values can be ranked across units:
// "1.24B" / "27.3B" / "756b" → 1.24 / 27.3 / 756, and Ollama reports
// sub-1B models in megaparams — "494.03M" → 0.494, "137M" → 0.137 — which
// would otherwise rank ABOVE a 1B model. Non-finite when absent.
export function parseParameterSize(parameterSize?: string): number {
  if (!parameterSize) return Number.NaN;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kKmMbB]?)/.exec(parameterSize.trim());
  if (!match) return Number.NaN;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return Number.NaN;
  const unit = match[2].toLowerCase();
  if (unit === 'm') return value / 1000; // megaparams → billions
  if (unit === 'k') return value / 1_000_000; // kiloparams → billions
  return value; // B suffix (or none) → already billions
}

// Sort comparator ranking models by speed: fewer parameters = faster.
// Models without a parseable parameter size rank last (tie-broken by file
// size, so a known tiny model always beats an unknown one).
export function compareModelsBySpeed(a: InstalledModel, b: InstalledModel): number {
  const pa = parseParameterSize(a.parameterSize);
  const pb = parseParameterSize(b.parameterSize);
  const ra = Number.isFinite(pa) ? pa : Number.MAX_SAFE_INTEGER;
  const rb = Number.isFinite(pb) ? pb : Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  return a.size - b.size;
}

// Non-mutating sort of models by speed (smallest parameter size first).
export function sortModelsBySpeed(models: InstalledModel[]): InstalledModel[] {
  return [...models].sort(compareModelsBySpeed);
}

// Rank chat models by speed: fewer parameters = faster. Models without a
// parseable parameter size rank last (tie-broken by file size, so a known
// tiny model always beats an unknown one).
export function pickFastestChatModel(models: InstalledModel[]): InstalledModel | undefined {
  const chat = models.filter((model) => !isEmbeddingModel(model));
  if (chat.length === 0) return undefined;
  return sortModelsBySpeed(chat)[0];
}
