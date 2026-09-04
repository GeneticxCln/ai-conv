import { useState, useEffect, useCallback } from 'react';

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

// NOTE: Window.electronAPI global type is declared in hooks/useSocket.ts
// (single shared declaration) so useAutoUpdate and useSocket don't conflict.

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export function useAutoUpdate() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return; // Not running in Electron

    api.getVersion?.().then(setAppVersion);

    api.onUpdateChecking?.(() => {
      setStatus('checking');
      setError(null);
    });

    api.onUpdateAvailable?.((info: UpdateInfo) => {
      setStatus('available');
      setUpdateInfo(info);
      setError(null);
      // Trigger download automatically
      setStatus('downloading');
    });

    api.onDownloadProgress?.((p: DownloadProgress) => {
      setProgress(p);
      setStatus('downloading');
    });

    api.onUpdateDownloaded?.((info: UpdateInfo) => {
      setStatus('downloaded');
      setUpdateInfo(info);
      setProgress(null);
    });

    api.onUpdateError?.((err: Error) => {
      setStatus('error');
      setError(err.message);
    });
  }, []);

  const checkForUpdates = useCallback(() => {
    window.electronAPI?.checkForUpdates?.();
  }, []);

  const installUpdate = useCallback(() => {
    window.electronAPI?.quitAndInstall?.();
  }, []);

  return {
    status,
    updateInfo,
    progress,
    error,
    appVersion,
    checkForUpdates,
    installUpdate,
  };
}
