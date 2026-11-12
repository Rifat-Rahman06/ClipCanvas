import { normalizeCapturedText } from '../lib/utils';
import { selectionToMarkdown } from './selectionMarkdown';

const READ_MESSAGE = 'clipcanvas:read-selection';

interface SelectionPayload {
  text: string;
}

interface ClipCanvasContentGlobal {
  __clipcanvasSelectionBridge?: boolean;
}

function readSelectionText(): string {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end > start) return active.value.slice(start, end);
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return '';
  return selectionToMarkdown(selection);
}

function respondWithSelection(): SelectionPayload {
  return { text: normalizeCapturedText(readSelectionText()) };
}

const globals = globalThis as typeof globalThis & ClipCanvasContentGlobal;

if (!globals.__clipcanvasSelectionBridge) {
  globals.__clipcanvasSelectionBridge = true;

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return undefined;
    if ((message as { type?: unknown }).type !== READ_MESSAGE) return undefined;
    try {
      sendResponse(respondWithSelection());
    } catch {
      sendResponse({ text: '' });
    }
    return undefined;
  });
}
