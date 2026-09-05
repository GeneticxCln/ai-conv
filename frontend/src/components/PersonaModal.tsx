import { useState, useEffect, useCallback } from 'react';
import { X, Download } from 'lucide-react';
import { Persona } from '@ai-conv/types';
import { InstalledModel, sortModelsBySpeed, isEmbeddingModel, pickFastestChatModel } from '../lib/modelPicker';
import { vramWarning } from '../lib/vram';
import { FastestBadge, EmbeddingBadge } from './ModelBadges';

interface PersonaModalProps {
  open: boolean;
  editing: Persona | null;
  getModels: () => Promise<InstalledModel[]>;
  getGpuInfo: () => Promise<{ available: boolean; name?: string; totalMiB?: number; usedMiB?: number }>;
  pullModel: (modelName: string) => void;
  onClose: () => void;
  onSave: (data: Partial<Persona>) => void;
  onDelete?: (id: string) => void;
}

const AVATARS = ['🤖', '😎', '🧠', '🎭', '🌟', '🎯', '🎨', '📚', '🎵', '💪', '🍳', '🌍'];

export function PersonaModal({ open, editing, getModels, getGpuInfo, pullModel, onClose, onSave, onDelete }: PersonaModalProps) {
  // State initializes from `editing` per mount; PersonaSidebar remounts via `key`.
  const [name, setName] = useState(editing?.name || '');
  const [avatar, setAvatar] = useState(editing?.avatar || '🤖');
  const [description, setDescription] = useState(editing?.description || '');
  const [systemPrompt, setSystemPrompt] = useState(editing?.systemPrompt || '');
  const [temperature, setTemperature] = useState(editing?.temperature ?? 0.7);
  const [enabledTools, setEnabledTools] = useState(editing?.enabledTools ?? false);
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [gpu, setGpu] = useState<{ available: boolean; name?: string; totalMiB?: number; usedMiB?: number } | null>(null);
  const [model, setModel] = useState(editing?.model || '');
  const [modelError, setModelError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [pullingModel, setPullingModel] = useState<string | null>(null);

  // Validate model against backend when model selection changes
  const validateModel = useCallback((modelName: string) => {
    if (!modelName) {
      setModelError(null);
      setAvailableModels([]);
      return;
    }

    // Check if model exists in our local list first
    if (models.some((m) => m.name === modelName)) {
      setModelError(null);
      return;
    }

    // If not in list, try to validate via socket (will be handled by backend)
    // For now, just show a warning
    setModelError(`Model "${modelName}" not in downloaded models list. You can pull it.`);
    setAvailableModels(models.map((m) => m.name));
  }, [models]);

  useEffect(() => {
    if (open) {
      getModels().then((list) => {
        setModels(list);
        setModel((cur) => (cur && list.some((m) => m.name === cur) ? cur : list[0]?.name || ''));
      });
      // Best-effort; null on failure keeps the VRAM warning silent.
      getGpuInfo().then(setGpu).catch(() => setGpu(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch models once per open
  }, [open, getModels]);

  if (!open) return null;

  const valid = name.trim().length > 0 && systemPrompt.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[440px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            {editing ? 'Edit Persona' : 'New Persona'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Avatar</label>
            <div className="flex flex-wrap gap-1.5">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center ${
                    avatar === a ? 'bg-blue-100 ring-2 ring-blue-500' : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1">Short description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. My sarcastic best friend"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1">
              Personality (system prompt) *
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Describe how this persona talks and behaves..."
              rows={5}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1">Model (downloaded in Ollama)</label>
            {models.length > 0 ? (
              <>
                <select
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    validateModel(e.target.value);
                  }}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {sortModelsBySpeed(models).map((m) => {
                    const isFastest = pickFastestChatModel(models)?.name === m.name;
                    return (
                      <option key={m.name} value={m.name} className="flex items-center gap-1.5">
                        {m.name}
                        {isFastest ? ' ⚡ fastest' : ''}
                        {isEmbeddingModel(m) ? ' (embedding)' : ''}
                      </option>
                    );
                  })}
                </select>
                {/* Under the dropdown, show the badges (native <option> can't render
                    chips) so users see which model is fastest before choosing. */}
                {(() => {
                  const fastest = pickFastestChatModel(models);
                  const sorted = sortModelsBySpeed(models);
                  const f = sorted.find((m) => m.name === model);
                  const warn = vramWarning(f, gpu);
                  return (
                    <div className="mt-1.5 flex items-start gap-1.5 flex-wrap text-xs">
                      {fastest && (
                        <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                          <FastestBadge />
                        </span>
                      )}
                      {f && isEmbeddingModel(f) && (
                        <span className="flex items-center gap-1.5">
                          <EmbeddingBadge />
                          <span className="text-xs text-gray-400">cannot chat</span>
                        </span>
                      )}
                      {warn && (
                        <span
                          className={`w-full flex items-start gap-1.5 rounded px-2 py-1.5 ${
                            warn.level === 'error'
                              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          <span>⚠</span>
                          <span>{warn.message}</span>
                        </span>
                      )}
                    </div>
                  );
                })()}
                {modelError && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <span>⚠</span>
                    <span>{modelError}</span>
                    {availableModels.length > 0 && (
                      <span className="ml-auto text-gray-400">
                        Available: {availableModels.slice(0, 3).join(', ')}
                        {availableModels.length > 3 && '...'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        pullModel(model);
                        setPullingModel(model);
                      }}
                      disabled={pullingModel !== null}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Pull
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                No downloaded models found — pull one with <code>ollama pull</code>
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Creativity: <span className="text-gray-900">{temperature.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>precise</span>
              <span>wild</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1">
              Tools
            </label>
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <span className="text-sm text-gray-700 dark:text-gray-200">
                Enable tools
                <span className="block text-xs text-gray-400">Give this persona access to web search and other tools</span>
              </span>
              <button
                type="button"
                onClick={() => setEnabledTools(!enabledTools)}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  enabledTools ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    enabledTools ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
          {editing && onDelete ? (
            <button
              onClick={() => {
                onDelete(editing.id);
                onClose();
              }}
              className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              Cancel
            </button>
            <button
              disabled={!valid}
              onClick={() => {
                onSave({ name: name.trim(), avatar, description: description.trim(), systemPrompt: systemPrompt.trim(), temperature, model, enabledTools });
                onClose();
              }}
              className={`px-4 py-2 text-sm font-medium rounded-lg ${
                valid ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {editing ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
