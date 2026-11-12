export const CAPTURE_POPUP_KEY = 'clipcanvas.capturePopup.v2';

export interface CapturePopupPayload {
  id: string;
  createdAt: string;
  text?: string;
  notice?: string;
}

export function isCapturePopupPayload(value: unknown): value is CapturePopupPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CapturePopupPayload>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (typeof candidate.text === 'string' || typeof candidate.notice === 'string')
  );
}

export function hasSessionStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.session);
}

export async function readCapturePopup(id: string): Promise<CapturePopupPayload | null> {
  if (!hasSessionStorage()) return null;
  try {
    const stored = await chrome.storage.session.get(CAPTURE_POPUP_KEY);
    const value = stored[CAPTURE_POPUP_KEY];
    return isCapturePopupPayload(value) && value.id === id ? value : null;
  } catch {
    return null;
  }
}

export async function clearCapturePopup(): Promise<void> {
  if (!hasSessionStorage()) return;
  try {
    await chrome.storage.session.remove(CAPTURE_POPUP_KEY);
  } catch {
    // The popup is already closing; a stale transient value is harmless.
  }
}
