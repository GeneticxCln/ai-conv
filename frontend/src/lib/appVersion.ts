import { getVersion } from '@tauri-apps/api/app';

/**
 * App version for the About page. Reads the Tauri app version when running
 * inside the desktop shell; falls back to the packaged version string in
 * browser/dev contexts where the Tauri API is unavailable.
 */
export async function getAppVersion(): Promise<string> {
  try {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const v = await getVersion();
      if (v) return v;
    }
  } catch {
    // Non-Tauri context or IPC unavailable — fall through to the default.
  }
  // Vite injects this from frontend/package.json so the browser fallback
  // cannot drift behind a release bump.
  return __APP_VERSION__;
}
