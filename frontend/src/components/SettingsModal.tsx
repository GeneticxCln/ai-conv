import { useState, useEffect } from 'react';
import { X, Moon, Sun, Trash2, RefreshCw, Download, Upload, Database, Cpu, Settings, AlertTriangle, Info, Monitor, CheckCircle2, RotateCcw, Loader2 } from 'lucide-react';
import { useChatStore } from '../stores/useChatStore';
import { InstalledModel, sortModelsBySpeed, isEmbeddingModel, pickFastestChatModel } from '../lib/modelPicker';
import { GpuInfo, modelFitsInVram } from '../lib/vram';
import { FastestBadge, EmbeddingBadge, TooBigForVramBadge } from './ModelBadges';
import { getAppVersion } from '../lib/appVersion';
import { checkForAppUpdate, downloadAndInstallAppUpdate, relaunchApp, isTauriRuntime } from '../lib/updater';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onClearConversations: () => void;
  getModels: () => Promise<InstalledModel[]>;
  getGpuInfo: () => Promise<GpuInfo>;
  pullModel: (name: string) => void;
  exportData: () => Promise<Record<string, unknown> | null>;
  importData: (file: File) => Promise<{ ok: boolean; error?: string }>;
}

type Tab = 'general' | 'models' | 'data' | 'advanced' | 'about';

const NAV_ITEMS: { id: Tab; label: string; description: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', description: 'Theme & behavior', icon: Settings },
  { id: 'models', label: 'Models', description: 'Local LLMs', icon: Cpu },
  { id: 'data', label: 'Data', description: 'Import / export', icon: Database },
  { id: 'advanced', label: 'Advanced', description: 'Destructive actions', icon: AlertTriangle },
  { id: 'about', label: 'About', description: 'Version & updates', icon: Info },
];

export function SettingsModal({ open, onClose, onClearConversations, getModels, getGpuInfo, pullModel, exportData, importData }: SettingsModalProps) {
  const theme = useChatStore((s) => s.theme);
  const setTheme = useChatStore((s) => s.setTheme);
  const agentChat = useChatStore((s) => s.agentChat);
  const setAgentChat = useChatStore((s) => s.setAgentChat);
  const connected = useChatStore((s) => s.connected);
  const pullProgress = useChatStore((s) => s.pullProgress);

  const [confirmClear, setConfirmClear] = useState(false);

  const [models, setModels] = useState<InstalledModel[]>([]);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
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

  // About page: version + manual update check.
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'ready' | 'error'>('idle');
  const [updateVersion, setUpdateVersion] = useState('');
  const [updatePct, setUpdatePct] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState('');

  // 743145283 → "743 MB", 4920736116 → "4.9 GB".
  const formatBytes = (bytes: number) =>
    bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

  const checkHealth = () => {
    // Same-origin first (the desktop shells load the app FROM the backend, so
    // a relative URL is both correct and immune to localhost→::1 IPv6
    // resolution failures inside WebKitGTK). VITE_API_URL remains a dev/
    // browser override.
    const apiBase = import.meta.env.VITE_API_URL || window.location.origin;
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

  // Best-effort GPU report for the per-model VRAM tags. A null keeps the
  // badges silent on machines without a queryable GPU.
  const refreshGpu = () => {
    getGpuInfo().then(setGpu).catch(() => setGpu(null));
  };

  useEffect(() => {
    if (open) {
      checkHealth();
      refreshModels();
      refreshGpu();
      getAppVersion().then(setAppVersion);
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

  const runUpdateCheck = async () => {
    setUpdateError('');
    setUpdateState('checking');
    const result = await checkForAppUpdate();
    if (result) {
      setUpdateVersion(result.version);
      setUpdateState('available');
    } else {
      setUpdateState('uptodate');
    }
  };

  const runUpdateInstall = async () => {
    setUpdateError('');
    setUpdatePct(0);
    setUpdateState('downloading');
    try {
      await downloadAndInstallAppUpdate((p) => {
        if (p.total) setUpdatePct(Math.min(100, Math.round((p.received / p.total) * 100)));
      });
      setUpdateState('ready');
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
      setUpdateState('error');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-[980px] max-w-[92vw] h-[680px] max-h-[88vh] overflow-hidden flex flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ============ SIDEBAR NAVIGATION ============ */}
        <aside className="w-52 shrink-0 bg-gray-50 dark:bg-gray-900/60 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Settings className="w-4 h-4 text-blue-500" />
              Settings
            </h2>
            <button onClick={onClose} aria-label="Close settings" className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500">
              <X className="w-4 h-4" />
            </button>
          </div>
          <nav role="tablist" aria-label="Settings sections" className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
            {NAV_ITEMS.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`relative w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  activeTab === id
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-600 hover:bg-gray-200/60 dark:text-gray-300 dark:hover:bg-gray-700/60'
                }`}
              >
                {activeTab === id && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-blue-600" aria-hidden="true" />
                )}
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${activeTab === id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate">{description}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        {/* ============ CONTENT PANE ============ */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* GENERAL TAB */}
            {activeTab === 'general' && (
              <>
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5" />
                    Appearance &amp; Conversation
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-gray-50 dark:bg-gray-700/50">
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

                    <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                      <span className="text-sm text-gray-700 dark:text-gray-200">
                        Personas talk to each other
                        <span className="block text-xs text-gray-400">One extra round after they answer you</span>
                      </span>
                      <button
                        onClick={() => setAgentChat(!agentChat)}
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${
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
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5" />
                      System Status
                    </h3>
                    <button
                      onClick={checkHealth}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Refresh
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Backend API', ok: health?.backend, okText: 'Online', downText: 'Offline' },
                      { label: 'Ollama LLM Engine', ok: health?.ollama, okText: 'Online', downText: 'Offline' },
                      { label: 'Redis Scaling', ok: health?.redis, okText: 'Connected', downText: 'Standalone', neutral: true },
                    ].map(({ label, ok, okText, downText, neutral }) => (
                      <div key={label} className="px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              ok === undefined
                                ? 'bg-gray-300 animate-pulse'
                                : ok
                                  ? 'bg-green-500'
                                  : neutral
                                    ? 'bg-gray-400'
                                    : 'bg-red-500'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{label}</span>
                        </div>
                        <p className={`mt-1 text-sm font-semibold ${
                          ok === undefined
                            ? 'text-gray-400'
                            : ok
                              ? 'text-green-600 dark:text-green-400'
                              : neutral
                                ? 'text-gray-500 dark:text-gray-400'
                                : 'text-red-500'
                        }`}>
                          {ok === undefined ? 'Checking…' : ok ? okText : downText}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* MODELS TAB */}
            {activeTab === 'models' && (
              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  Installed Models
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Left: installed list */}
                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">
                        Sorted fastest first · {models.length} model{models.length !== 1 ? 's' : ''}
                      </span>
                      <button
                        onClick={refreshModels}
                        disabled={!connected}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                      </button>
                    </div>
                    <div className="px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 space-y-2.5 max-h-[420px] overflow-y-auto">
                      {models.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-6">No models downloaded yet.</p>
                      )}
                      {(() => {
                        const sorted = sortModelsBySpeed(models);
                        const fastest = pickFastestChatModel(sorted);
                        return sorted.map((m) => {
                          const p = pullProgress[m.name];
                          const embedding = isEmbeddingModel(m);
                          const tooBig = gpu && !modelFitsInVram(m, gpu);
                          return (
                            <div
                              key={m.name}
                              data-testid="installed-model-row"
                              data-model-name={m.name}
                              data-parameter-size={m.parameterSize ?? ''}
                              data-model-size={String(m.size)}
                              data-model-capabilities={m.capabilities?.join(',') ?? ''}
                              className={`text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2 pb-2 border-b border-gray-200/60 dark:border-gray-600/40 last:border-0 last:pb-0 ${embedding ? 'opacity-60' : ''}`}
                            >
                              <span className="truncate font-mono flex items-center gap-1.5">
                                {m.name}
                                {fastest && m.name === fastest.name && <FastestBadge />}
                                {embedding && <EmbeddingBadge />}
                                {tooBig && <TooBigForVramBadge />}
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
                  </div>

                  {/* Right: pull + GPU */}
                  <div className="space-y-4">
                    <div className="px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5" />
                        Pull New Model
                      </h4>
                      <div className="flex flex-col gap-2">
                        <input
                          value={newModel}
                          onChange={(e) => setNewModel(e.target.value)}
                          placeholder="e.g. mistral:7b, codellama:13b"
                          className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          disabled={!newModel.trim() || !connected}
                          onClick={() => {
                            pullModel(newModel.trim());
                            setNewModel('');
                          }}
                          className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Pull
                        </button>
                        <p className="text-[10px] text-gray-400">Names from <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-500">Ollama Library</a></p>
                      </div>
                    </div>

                    <div className="px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                        <Monitor className="w-3.5 h-3.5" />
                        GPU / VRAM
                      </h4>
                      {gpu?.available ? (
                        <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
                          <p className="font-medium text-gray-700 dark:text-gray-200 truncate">{gpu.name}</p>
                          <p>
                            {gpu.usedMiB ?? '—'} / {gpu.totalMiB ?? '—'} MiB used
                          </p>
                          {gpu.totalMiB ? (
                            <div className="h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-500 transition-all"
                                style={{ width: `${Math.min(100, Math.round(((gpu.usedMiB ?? 0) / gpu.totalMiB) * 100))}%` }}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">No queryable GPU detected.</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* DATA TAB */}
            {activeTab === 'data' && (
              <>
                <section>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="px-4 py-4 rounded-xl bg-gray-50 dark:bg-gray-700/50 space-y-2.5">
                      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5" />
                        Export
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300">Export all conversations, personas, and settings as a single JSON file.</p>
                      <button
                        onClick={handleExport}
                        className="flex items-center gap-1.5 w-full justify-center px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
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

                    <div className="px-4 py-4 rounded-xl bg-gray-50 dark:bg-gray-700/50 space-y-2.5">
                      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5" />
                        Import
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300">Import a previously exported JSON file. This will merge conversations and personas.</p>
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
                        className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        disabled={!importFile || importStatus === 'pending'}
                        onClick={() => importFile && handleImport(importFile)}
                        className="flex items-center gap-1.5 w-full justify-center px-3 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
                      >
                        <Upload className="w-4 h-4" />
                        {importStatus === 'pending' ? 'Importing...' : 'Import'}
                      </button>
                      {importStatus === 'success' && (
                        <p className="text-xs text-green-500">Import successful!</p>
                      )}
                      {importStatus === 'error' && (
                        <p className="text-xs text-red-500">Import failed. Check file format.</p>
                      )}
                    </div>
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
              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Danger Zone
                </h3>
                <div className="px-4 py-3.5 rounded-xl bg-red-50 dark:bg-red-900/20">
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
            )}

            {/* ABOUT TAB */}
            {activeTab === 'about' && (
              <>
                <section>
                  <div className="px-4 py-5 rounded-xl bg-gray-50 dark:bg-gray-700/50 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                      <Settings className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">AI Conv</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {appVersion ? `Version ${appVersion}` : 'Reading version…'} — local multi-persona messenger powered by Ollama.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    Updates
                  </h3>
                  <div className="px-4 py-3.5 rounded-xl bg-gray-50 dark:bg-gray-700/50 space-y-3">
                    {!isTauriRuntime() && (
                      <p className="text-xs text-gray-400">Auto-update is only available in the desktop app.</p>
                    )}
                    {updateState === 'idle' && (
                      <button
                        onClick={runUpdateCheck}
                        disabled={!isTauriRuntime()}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Check for updates
                      </button>
                    )}
                    {updateState === 'checking' && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        Checking for updates…
                      </div>
                    )}
                    {updateState === 'uptodate' && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        You're on the latest version{appVersion ? ` (v${appVersion})` : ''}.
                        <button onClick={() => setUpdateState('idle')} className="ml-2 text-xs text-blue-500 hover:underline">
                          Check again
                        </button>
                      </div>
                    )}
                    {updateState === 'available' && (
                      <div className="space-y-2">
                        <p className="text-sm text-gray-700 dark:text-gray-200">
                          <span className="font-medium">v{updateVersion}</span> is available — download &amp; install now?
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={runUpdateInstall}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                          >
                            <Download className="w-4 h-4" />
                            Download &amp; install
                          </button>
                          <button onClick={() => setUpdateState('idle')} className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg">
                            Later
                          </button>
                        </div>
                      </div>
                    )}
                    {updateState === 'downloading' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                          Downloading v{updateVersion}…{updatePct != null ? ` ${updatePct}%` : ''}
                        </div>
                        <div className="h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all" style={{ width: `${updatePct ?? 0}%` }} />
                        </div>
                      </div>
                    )}
                    {updateState === 'ready' && (
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <p className="text-sm text-gray-700 dark:text-gray-200">Update installed — restart to apply.</p>
                        <button
                          onClick={() => relaunchApp()}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Restart
                        </button>
                      </div>
                    )}
                    {updateState === 'error' && (
                      <div className="flex items-center gap-2 text-sm text-red-500">
                        <AlertTriangle className="w-4 h-4" />
                        Update failed: {updateError}
                        <button onClick={() => setUpdateState('idle')} className="ml-2 text-xs text-blue-500 hover:underline">
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" />
                    About
                  </h3>
                  <div className="px-4 py-3.5 rounded-xl bg-gray-50 dark:bg-gray-700/50 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <p>Your personas, your models, your data — everything runs locally, nothing leaves your machine.</p>
                    <p className="font-mono">SQLite + React + Fastify + Socket.io + Ollama · Tauri shell</p>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
