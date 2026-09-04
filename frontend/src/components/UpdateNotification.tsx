import { useAutoUpdate } from '../hooks/useAutoUpdate';
import { Download, RefreshCw, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useState } from 'react';

export function UpdateNotification() {
  const { status, updateInfo, progress, error, installUpdate, checkForUpdates } = useAutoUpdate();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || status === 'idle') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-4">
        {/* Checking */}
        {status === 'checking' && (
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
            <div>
              <p className="text-sm font-medium text-white">Checking for updates...</p>
              <p className="text-xs text-gray-400">This may take a moment</p>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="ml-auto text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Available / Downloading */}
        {status === 'available' && (
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5 text-blue-400" />
            <div>
              <p className="text-sm font-medium text-white">
                Update available: v{updateInfo?.version}
              </p>
              <p className="text-xs text-gray-400">Downloading...</p>
            </div>
          </div>
        )}

        {status === 'downloading' && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-blue-400 animate-pulse" />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">
                  Downloading v{updateInfo?.version}
                </p>
                {progress && (
                  <p className="text-xs text-gray-400">
                    {Math.round(progress.percent)}% • {(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s
                  </p>
                )}
              </div>
              <button
                onClick={() => setDismissed(true)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {progress && (
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(progress.percent, 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Downloaded — ready to install */}
        {status === 'downloaded' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <div>
                <p className="text-sm font-medium text-white">
                  Update ready: v{updateInfo?.version}
                </p>
                <p className="text-xs text-gray-400">Restart to apply the update</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={installUpdate}
                className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md font-medium transition-colors"
              >
                Restart &amp; Update
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-md transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              <div>
                <p className="text-sm font-medium text-white">Update check failed</p>
                <p className="text-xs text-gray-400">{error}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={checkForUpdates}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors"
              >
                Retry
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-md transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
