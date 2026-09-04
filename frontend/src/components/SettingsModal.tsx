import { useState, useEffect } from 'react';
import { X, Moon, Sun, Trash2, RefreshCw, Download, Upload, Database, Cpu, HardDrive, Settings, AlertTriangle } from 'lucide-react';
import { useChatStore } from '../stores/useChatStore';
import { InstalledModel, sortModelsBySpeed, isEmbeddingModel, pickFastestChatModel } from '../lib/modelPicker';
import { FastestBadge, EmbeddingBadge } from './ModelBadges';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onClearConversations: () => void;
  getModels: () => Promise<InstalledModel[]>;
  pullModel: (name: string) => void;
  exportData: () => Promise<Record<string, unknown> | null>;
  importData: (file: File) => Promise<{ ok: boolean; error?: string }>;
}

type Tab = 'general' | 'models' | 'data' | 'advanced';

export function SettingsModal({ open, onClose, onClearConversations, getModels, pullModel, exportData, importData }: SettingsModalProps) {
  const theme = useChatStore((s) => s.theme);
  const setTheme = useChatStore((s) => s.setTheme);
  const agentChat = useChatStore((s) => s.agentChat);
  const setAgentChat = useChatStore((s) => s.setAgentChat);
  const connected = useChatStore((s) => s.connected);
  const pullProgress = useChatStore((s) => s.pullProgress);

  const [confirmClear, setConfirmClear] = useState(false);

  const [models, setModels] = useState<InstalledModel[]>([]);
  const [newModel, setNewModel] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [health, setHealth] = useState<{
    backend: boolean;
    ollama: boolean;
    redis: boolean;
  } | null>(null);
  // 743145283 → "743 MB", 4920736116 → "4.9 GB".
  const formatBytes = (bytes: number) =>
    bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

  const checkHealth = () => {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    fetch(`${apiBase}/health`)
      .then((r) => (r && r.ok ? r.json() : Promise.reject(new Error('health check failed'))))
      .then((d: unknown) => {
        const data = d as { status?: string; ollama?: boolean; redis?: boolean } | null;
        setHealth({
          backend: data?.status === 'ok',
          ollama: Boolean(data?.ollama),
          redis: Boolean(data?.redis),
        });
      })
      .catch(() => setHealth({ backend: false, ollama: false, redis: false }));
  };

  const refreshModels = () => {
    getModels().then(setModels);
  };

  useEffect(() => {
    if (open) {
      checkHealth();
      refreshModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per open
  }, [open]);

  const handleExport = async () => {
    setExportStatus('pending');
    try {
      const data = await exportData();
      if (!data) {
        setExportStatus('error');
        setTimeout(() => setExportStatus('idle'), 2000);
        return;
      }
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aiconv-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke on a later tick — Chromium can cancel the download if the
      // blob URL is revoked synchronously before the download starts.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus('success');
      setTimeout(() => setExportStatus('idle'), 2000);
    } catch {
      setExportStatus('error');
      setTimeout(() => setExportStatus('idle'), 2000);
    }
  };

  const handleImport = async (file: File) => {
    setImportStatus('pending');
    try {
      await importData(file);
      setImportStatus('success');
      setImportFile(null);
      setShowImportConfirm(false);
      // Backend broadcasts refreshed persona/conversation lists via socket
      // when import succeeds — no manual refresh needed.
    } catch {
      setImportStatus('error');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[480px] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with tabs */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button onClick={onClose} aria-label="Close settings" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab navigation */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex -mb-px" role="tablist">
            {[
              { id: 'general', label: 'General', icon: Settings },
              { id: 'models', label: 'Models', icon: Cpu },
              { id: 'data', label: 'Data', icon: Database },
              { id: 'advanced', label: 'Advanced', icon: HardDrive },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id as Tab)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === id
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab panels */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* GENERAL TAB */}
          {activeTab === 'general' && (
            <>
              {/* Appearance */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                  <Moon className="w-3.5 h-3.5" />
                  Appearance
                </h3>
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
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        theme === 'dark' ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </section>

              {/* Conversation */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  Conversation
                </h3>
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
                    aria-label={agentChat ? 'Disable agent-to-agent chat' : 'Enable agent-to-agent chat'}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        agentChat ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </section>

              {/* System Status */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" />
                  System Status
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs">
                    <span className="text-gray-700 dark:text-gray-200">Backend API</span>
                    <span className={`font-medium ${health?.backend ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      {health?.backend ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs">
                    <span className="text-gray-700 dark:text-gray-200">Ollama LLM Engine</span>
                    <span className={`font-medium ${health?.ollama ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      {health?.ollama ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs">
                    <span className="text-gray-700 dark:text-gray-200">Redis Scaling</span>
                    <span className={`font-medium ${health?.redis ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                      {health?.redis ? 'Connected' : 'Standalone'}
                    </span>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* MODELS TAB */}
          {activeTab === 'models' && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" />
                Installed Models
              </h3>
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={refreshModels}
                  disabled={!connected}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
                <span className="text-xs text-gray-400">{models.length} model{models.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 space-y-2 max-h-60 overflow-y-auto">
                {models.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">No models downloaded yet.</p>
                )}
                {(() => {
                  const sorted = sortModelsBySpeed(models);
                  const fastest = pickFastestChatModel(sorted);
                  return sorted.map((m) => {
                    const p = pullProgress[m.name];
                    const embedding = isEmbeddingModel(m);
                    return (
                      <div
                        key={m.name}
                        data-testid="installed-model-row"
                        data-model-name={m.name}
                        data-parameter-size={m.parameterSize ?? ''}
                        data-model-size={String(m.size)}
                        data-model-capabilities={m.capabilities?.join(',') ?? ''}
                        className={`text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2 ${embedding ? 'opacity-60' : ''}`}
                      >
                        <span className="truncate font-mono flex items-center gap-1.5">
                          {m.name}
                          {fastest && m.name === fastest.name && <FastestBadge />}
                          {embedding && <EmbeddingBadge />}
                        </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {m.parameterSize && <span className="text-xs text-gray-400">{m.parameterSize}</span>}
                        {m.size > 0 && <span className="text-xs text-gray-400">{formatBytes(m.size)}</span>}
                        {p && p.status !== 'done' && (
                          <span className="text-xs text-gray-400">
                            {p.status}{p.percent != null ? ` ${p.percent}%` : ''}
                          </span>
                        )}
                        {p?.status === 'done' && <span className="text-xs text-green-500">ready</span>}
                      </span>
                    </div>
                  );
                  });
                })()}
                {Object.entries(pullProgress).map(([m, p]) =>
                  p.status !== 'done' && !models.some((x) => x.name === m) ? (
                    <div key={m}>
                      <div className="text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between">
                        <span className="truncate font-mono">{m}</span>
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
              </div>

              {/* Pull new model */}
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  Pull New Model
                </h3>
                <div className="flex gap-2">
                  <input
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    placeholder="e.g. mistral:7b, codellama:13b"
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
                <p className="text-[10px] text-gray-400 mt-1">Model name from <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-500">Ollama Library</a></p>
              </div>
            </section>
          )}

          {/* DATA TAB */}
          {activeTab === 'data' && (
            <>
              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  Export
                </h3>
                <div className="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Export all conversations, personas, and settings as a single JSON file.</p>
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-1.5 w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Download className="w-4 h-4" />
                    Export All Data (JSON)
                  </button>
                  {exportStatus === 'pending' && (
                    <p className="text-xs text-blue-500">Exporting...</p>
                  )}
                  {exportStatus === 'success' && (
                    <p className="text-xs text-green-500">Download started!</p>
                  )}
                  {exportStatus === 'error' && (
                    <p className="text-xs text-red-500">Export failed</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  Import
                </h3>
                <div className="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Import a previously exported JSON file. This will merge conversations and personas.</p>
                  <div className="flex gap-2">
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setImportFile(file);
                          setShowImportConfirm(true);
                        }
                      }}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      disabled={!importFile || importStatus === 'pending'}
                      onClick={() => importFile && handleImport(importFile)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {importStatus === 'pending' ? 'Importing...' : 'Import'}
                    </button>
                  </div>
                  {importStatus === 'success' && (
                    <p className="text-xs text-green-500">Import successful!</p>
                  )}
                  {importStatus === 'error' && (
                    <p className="text-xs text-red-500">Import failed. Check file format.</p>
                  )}
                </div>

                {/* Import confirmation dialog */}
                {showImportConfirm && importFile && (
                  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowImportConfirm(false)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[400px] p-5" onClick={(e) => e.stopPropagation()}>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Confirm Import</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                        This will merge data from <strong>{importFile.name}</strong>. Existing conversations and personas with matching IDs will be updated.
                      </p>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setShowImportConfirm(false)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                          Cancel
                        </button>
                        <button onClick={() => handleImport(importFile)} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700">
                          Import
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ADVANCED TAB */}
          {activeTab === 'advanced' && (
            <>
              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Danger Zone
                </h3>
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
                      className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:underline w-full"
                    >
                      <Trash2 className="w-4 h-4" />
                      Clear all conversations
                    </button>
                  )}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" />
                  About
                </h3>
                <div className="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <p>AI Conv v0.1 — local multi-persona messenger powered by Ollama.</p>
                  <p className="font-mono">SQLite + React + Fastify + Socket.io</p>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
