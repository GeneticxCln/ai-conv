/**
 * Clipboard helpers shared by the message bubbles and composer.
 *
 * Tauri's WebView and the browser both expose the async Clipboard API for
 * user-initiated actions. The write fallback keeps copy usable in older
 * WebViews; reads intentionally return null when permission is unavailable.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy document.execCommand path.
    }
  }

  if (typeof document === 'undefined' || !document.body) return false;

  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  fallback.style.pointerEvents = 'none';
  document.body.appendChild(fallback);
  fallback.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    fallback.remove();
  }
}

export async function readClipboardText(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return null;
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/** Replace a textarea selection and return the new value plus caret position. */
export function replaceSelection(
  value: string,
  start: number,
  end: number,
  replacement: string,
): { value: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  return {
    value: value.slice(0, safeStart) + replacement + value.slice(safeEnd),
    cursor: safeStart + replacement.length,
  };
}
