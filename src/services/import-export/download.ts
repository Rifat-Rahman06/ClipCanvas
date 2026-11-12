import { formatFileDate, formatFileTimestamp } from '../../lib/utils';

export function backupFilename(date = new Date()): string {
  return `research-notebook-backup-${formatFileDate(date)}.json`;
}

export function preImportBackupFilename(date = new Date()): string {
  return `research-notebook-pre-import-${formatFileTimestamp(date)}.json`;
}

function anchorDownload(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function anchorTextDownload(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function safeDownloadName(filename: string): string {
  return filename
    .replace(/["\\/:*?<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Uses the downloads API when available so backups land in Chrome's Downloads
 * folder with a predictable filename. Falls back to an anchor download when
 * the page is previewed outside an extension context.
 */
export async function downloadJson(filename: string, json: string): Promise<void> {
  const safeName = filename.replace(/["\\/:*?<>|]+/g, '-');
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    try {
      const downloadId = await chrome.downloads.download({
        url,
        filename: safeName,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      const cleanup = () => URL.revokeObjectURL(url);
      const listener = (delta: chrome.downloads.DownloadDelta) => {
        if (
          delta.id === downloadId &&
          delta.state &&
          (delta.state.current === 'complete' || delta.state.current === 'interrupted')
        ) {
          chrome.downloads.onChanged.removeListener(listener);
          cleanup();
        }
      };
      chrome.downloads.onChanged.addListener(listener);
      window.setTimeout(cleanup, 120_000);
      return;
    } catch {
      URL.revokeObjectURL(url);
      anchorDownload(safeName, json);
      return;
    }
  }

  URL.revokeObjectURL(url);
  anchorDownload(safeName, json);
}

export function readJsonFile(file: File): Promise<string> {
  return file.text();
}

/**
 * Downloads a note as a plain-text file. In the extension the downloads API
 * opens Chrome's Save As dialog so the user can pick the destination; outside
 * an extension context the anchor fallback still saves the file.
 */
export async function downloadTextFile(filename: string, text: string): Promise<void> {
  const safeName = safeDownloadName(filename) || 'note.txt';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    try {
      const downloadId = await chrome.downloads.download({
        url,
        filename: safeName,
        conflictAction: 'uniquify',
        saveAs: true,
      });
      const cleanup = () => URL.revokeObjectURL(url);
      const listener = (delta: chrome.downloads.DownloadDelta) => {
        if (
          delta.id === downloadId &&
          delta.state &&
          (delta.state.current === 'complete' || delta.state.current === 'interrupted')
        ) {
          chrome.downloads.onChanged.removeListener(listener);
          cleanup();
        }
      };
      chrome.downloads.onChanged.addListener(listener);
      window.setTimeout(cleanup, 120_000);
      return;
    } catch (error) {
      URL.revokeObjectURL(url);
      // Canceling the Save As dialog is a normal outcome, not a reason to
      // trigger a second download through the fallback path.
      if (error instanceof Error && /cancel/i.test(error.message)) throw error;
      anchorTextDownload(safeName, text);
      return;
    }
  }

  URL.revokeObjectURL(url);
  anchorTextDownload(safeName, text);
}
