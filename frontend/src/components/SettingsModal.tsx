import { useState, useEffect } from 'react';
import { X, Moon, Sun, Trash2, RefreshCw, Download } from 'lucide-react';
import { useChatStore } from '../stores/useChatStore';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onClearConversations: () => void;
  getModels: () => Promise<string[]>;
  pullModel: (name: string) => void;
}

export function SettingsModal({ open, onClose, onClearConversations, getModels, pullModel }: SettingsModalProps) {
  const theme = useChatStore((s) => s.theme);
  const setTheme = useChatStore((s) => s.setTheme);
  const agentChat = useChatStore((s) => s.agentChat);
  const setAgentChat = useChatStore((s) => s.setAgentChat);
  const connected = useChatStore((s) => s.connected);
  const pullProgress = useChatStore((s) => s.pullProgress);
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [confirmClear, setConfirmClear] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [newModel, setNewModel] = useState('');

  const refreshModels = () => {
    getModels().then(setModels);
  };

  useEffect(() => {
    if (open) {
      checkHealth();
      refreshModels();
    }
  }, [open]);

  const checkHealth = () => {
    setHealth('checking');
    fetch('http://localhost:3001/health')
      .then((r) => r.json())
      .then((d) => setHealth(d?.ollama ? 'ok' : 'down'))
      .catch(() => setHealth('down'));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[420px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Appearance */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Appearance</h3>
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <span className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
                {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                Dark mode
              </span>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  theme === 'dark' ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    theme === 'dark' ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Agent-to-agent */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Conversation</h3>
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <span className="text-sm text-gray-700 dark:text-gray-200">
                Personas talk to each other
                <span className="block text-xs text-gray-400">One extra round after they answer you</span>
              </span>
              <button
                onClick={() => setAgentChat(!agentChat)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  agentChat ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    agentChat ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Server */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Server</h3>
            <div className="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-200">Socket</span>
                <span className={connected ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-200">Ollama</span>
                <span className="flex items-center gap-2">
                  <span
                    className={
                      health === 'ok'
                        ? 'text-green-600 dark:text-green-400'
                        : health === 'down'
                        ? 'text-red-500'
                        : 'text-gray-400'
                    }
                  >
                    {health === 'ok' ? 'Online' : health === 'down' ? 'Offline' : '...'}
                  </span>
                  <button
                    onClick={checkHealth}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500"
                    title="Check connection"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${health === 'checking' ? 'animate-spin' : ''}`} />
                  </button>
                </span>
              </div>
            </div>
          </section>

          {/* Models */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Ollama models</h3>
              <button onClick={refreshModels} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500" title="Refresh">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 space-y-2">
              {models.length === 0 && (
                <p className="text-xs text-gray-400">No models downloaded yet.</p>
              )}
              {models.map((m) => {
                const p = pullProgress[m];
                return (
                  <div key={m} className="text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between">
                    <span className="truncate">{m}</span>
                    {p && p.status !== 'done' && (
                      <span className="text-xs text-gray-400">
                        {p.status}{p.percent != null ? ` ${p.percent}%` : ''}
                      </span>
                    )}
                    {p?.status === 'done' && <span className="text-xs text-green-500">ready</span>}
                  </div>
                );
              })}
              {Object.entries(pullProgress).map(([m, p]) =>
                p.status !== 'done' && !models.includes(m) ? (
                  <div key={m}>
                    <div className="text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between">
                      <span className="truncate">{m}</span>
                      <span className="text-xs text-blue-500">
                        {p.status}{p.percent != null ? ` ${p.percent}%` : ''}
                      </span>
                    </div>
                    {p.percent != null && (
                      <div className="h-1 bg-gray-200 dark:bg-gray-600 rounded-full mt-1 overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all" style={{ width: `${p.percent}%` }} />
                      </div>
                    )}
                  </div>
                ) : null
              )}
              <div className="flex gap-2 pt-1">
                <input
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder="e.g. mistral:7b"
                  className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  disabled={!newModel.trim() || !connected}
                  onClick={() => {
                    pullModel(newModel.trim());
                    setNewModel('');
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  Pull
                </button>
              </div>
            </div>
          </section>

          {/* Danger zone */}
          <section>
            <h3 className="text-xs font-semibold text-red-500 uppercase mb-2">Danger zone</h3>
            <div className="px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20">
              {confirmClear ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-red-700 dark:text-red-300">Delete ALL conversations?</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="px-3 py-1.5 text-xs rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        onClearConversations();
                        setConfirmClear(false);
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
                    >
                      Yes, delete
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:underline"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear all conversations
                </button>
              )}
            </div>
          </section>

          {/* About */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">About</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 px-3">
              AI Conv v0.1 — local multi-persona messenger powered by Ollama.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
