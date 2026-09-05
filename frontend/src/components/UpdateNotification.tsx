import { useEffect, useState } from 'react';
import { Download, RefreshCw, RotateCcw, X } from 'lucide-react';
import {
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  relaunchApp,
  type UpdateProgress,
} from '../lib/updater';

/**
 * Auto-update toast for the Tauri shell (electron-updater replacement).
 * Auto-checks on mount; silent when up-to-date, offline, or outside Tauri.
 */
export function UpdateNotification() {
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<{ version: string; notes?: string } | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Small delay so launch I/O (backend boot, model queries) isn't contended.
    const t = setTimeout(async () => {
      setChecking(true);
      const update = await checkForAppUpdate();
      if (!cancelled) setChecking(false);
      if (update && !cancelled) setAvailable(update);
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const install = async () => {
    setError(null);
    setProgress({ chunkLength: 0, received: 0 });
    try {
      await downloadAndInstallAppUpdate((p) => setProgress(p));
      setDownloaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Nothing to show — most common state: the launch auto-check found no
  // update. Must render null, otherwise an empty dark toast box sits in the
  // bottom-right corner above the chat composer.
  if (dismissed || (!checking && !available && !downloaded && !error)) return null;

  const pct =
    progress && progress.total
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-4">
        {checking && (
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
            <p className="text-sm text-white">Checking for updates…</p>
            <button onClick={() => setDismissed(true)} className="ml-auto text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {available && !downloaded && !error && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-blue-400" />
              <p className="text-sm font-medium text-white">Update available: v{available.version}</p>
              <button onClick={() => setDismissed(true)} className="ml-auto text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            {pct !== null ? (
              <div>
                <div className="h-1.5 bg-gray-700 rounded overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{pct}%</p>
              </div>
            ) : (
              <button
                onClick={install}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> Download &amp; install
              </button>
            )}
          </div>
        )}

        {downloaded && (
          <div className="flex items-center gap-3">
            <RotateCcw className="w-5 h-5 text-green-400" />
            <p className="text-sm text-white">Update installed — restart to apply</p>
            <button
              onClick={() => relaunchApp()}
              className="ml-auto px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-sm rounded"
            >
              Restart
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3">
            <X className="w-5 h-5 text-red-400" />
            <p className="text-sm text-white">Update failed: {error}</p>
            <button onClick={() => setDismissed(true)} className="ml-auto text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
