import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/**
 * Tauri auto-update client — the Electron-updater replacement.
 *
 * Flow: check() → (optional download with progress) → downloadAndInstall() →
 * relaunch(). All functions resolve to `null`/no-ops when the Tauri IPC is
 * unavailable (browser, dev server, E2E) or the endpoint is unreachable, so
 * callers never need try/catch and UI code stays trivial.
 */

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'uptodate'
  | 'error';

export interface UpdateProgress {
  /** Bytes of the current chunk. */
  chunkLength: number;
  /** Total bytes received so far. */
  received: number;
  /** Total size if the server advertises it (else undefined). */
  total?: number;
}

let cachedUpdate: Update | null = null;

/** True only when running inside the Tauri webview with IPC access. */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Check for an update. Returns null when none / not applicable / offline. */
export async function checkForAppUpdate(): Promise<{ version: string; notes?: string } | null> {
  if (!isTauriRuntime()) return null;
  try {
    const update = await check({ timeout: 10_000 });
    cachedUpdate = update ?? null;
    return update ? { version: update.version, notes: update.body ?? undefined } : null;
  } catch {
    // No endpoint configured yet, network down, or signature mismatch —
    // auto-update must never block or crash the app.
    cachedUpdate = null;
    return null;
  }
}

/** Download + install the previously checked update. Throws only on real install failures. */
export async function downloadAndInstallAppUpdate(
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  if (!cachedUpdate) throw new Error('No update available — call checkForAppUpdate first');
  let received = 0;
  let total: number | undefined;
  await cachedUpdate.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      received = 0;
      total = event.data.contentLength;
    } else if (event.event === 'Progress') {
      received += event.data.chunkLength;
      onProgress?.({
        chunkLength: event.data.chunkLength,
        received,
        total,
      });
    } else if (event.event === 'Finished') {
      // Installed — caller decides when to relaunch.
    }
  });
}

/** Restart the app into the freshly installed version. */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}
