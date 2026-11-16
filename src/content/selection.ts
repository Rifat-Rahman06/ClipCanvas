import { normalizeCapturedText } from '../lib/utils';
import { CAPTURE_READ_MESSAGE, CAPTURE_SELECTION_VERSION } from '../services/capture/messages';
import { selectionToMarkdown } from './selectionMarkdown';

interface SelectionPayload {
  text: string;
  version: number;
}

interface ClipCanvasContentGlobal {
  __clipcanvasSelectionBridgeV3?: boolean;
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
  return {
    text: normalizeCapturedText(readSelectionText()),
    version: CAPTURE_SELECTION_VERSION,
  };
}

const globals = globalThis as typeof globalThis & ClipCanvasContentGlobal;

if (!globals.__clipcanvasSelectionBridgeV3) {
  globals.__clipcanvasSelectionBridgeV3 = true;

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return undefined;
    if ((message as { type?: unknown }).type !== CAPTURE_READ_MESSAGE) return undefined;
    try {
      sendResponse(respondWithSelection());
    } catch {
      sendResponse({ text: '' });
    }
    return undefined;
  });
}
