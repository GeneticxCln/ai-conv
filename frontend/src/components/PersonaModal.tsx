import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Persona } from '../types';

interface PersonaModalProps {
  open: boolean;
  editing: Persona | null;
  getModels: () => Promise<string[]>;
  onClose: () => void;
  onSave: (data: Partial<Persona>) => void;
  onDelete?: (id: string) => void;
}

const AVATARS = ['🤖', '😎', '🧠', '🎭', '🌟', '🎯', '🎨', '📚', '🎵', '💪', '🍳', '🌍'];

export function PersonaModal({ open, editing, getModels, onClose, onSave, onDelete }: PersonaModalProps) {
  // State initializes from `editing` per mount; PersonaSidebar remounts via `key`.
  const [name, setName] = useState(editing?.name || '');
  const [avatar, setAvatar] = useState(editing?.avatar || '🤖');
  const [description, setDescription] = useState(editing?.description || '');
  const [systemPrompt, setSystemPrompt] = useState(editing?.systemPrompt || '');
  const [temperature, setTemperature] = useState(editing?.temperature ?? 0.7);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(editing?.model || '');

  useEffect(() => {
    if (open) {
      getModels().then((list) => {
        setModels(list);
        setModel((cur) => (cur && list.includes(cur) ? cur : list[0] || ''));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch models once per open
  }, [open]);

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
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
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
                onSave({ name: name.trim(), avatar, description: description.trim(), systemPrompt: systemPrompt.trim(), temperature, model });
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
