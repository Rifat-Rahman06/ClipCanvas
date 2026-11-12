import type { CaptureOutcome } from '../types';
import { normalizeCapturedText } from '../lib/utils';
import { CAPTURE_INSERT, type CaptureInsertResponse } from '../services/capture/messages';
import {
  captureNoticeForUrl,
  emptySelectionNotice,
  injectionBlockedNotice,
} from '../services/capture/selection';
import {
  CAPTURE_POPUP_KEY,
  clearCapturePopup,
  type CapturePopupPayload,
} from '../services/capture/popupCapture';

const CONTENT_READ = 'clipcanvas:read-selection';
const POPUP_WINDOW_KEY = 'clipcanvas.capturePopupWindow.v2';

const CAPTURE_MENU_ID = 'clipcanvas-capture-selection';
const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 720;

interface SelectionPayload {
  text: string;
}

let popupWindowId: number | null = null;

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

function openPanel(tab: chrome.tabs.Tab | null): void {
  // `sidePanel.open` must be called while the user gesture is still active, so
  // it is intentionally invoked before any awaiting work.
  try {
    if (tab?.id !== undefined) {
      void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
      return;
    }
    if (tab?.windowId !== undefined) {
      void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
      return;
    }
    void getActiveTab()
      .then((active) => {
        if (active?.windowId === undefined) return undefined;
        return chrome.sidePanel.open({ windowId: active.windowId });
      })
      .catch(() => undefined);
  } catch {
    // Older Chrome builds and some managed policies block the side panel.
  }
}

async function readFromContentScript(tabId: number): Promise<string | null> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: CONTENT_READ,
    })) as SelectionPayload | undefined;
    return response && typeof response.text === 'string' ? response.text : null;
  } catch {
    return null;
  }
}

async function readByInjection(tabId: number): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const active = document.activeElement;
        let text = '';
        if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
          const start = active.selectionStart ?? 0;
          const end = active.selectionEnd ?? 0;
          if (end > start) text = active.value.slice(start, end);
        }
        if (!text) text = window.getSelection()?.toString() ?? '';
        return { text };
      },
    });

    let best: string | null = null;
    for (const result of results) {
      const value = result.result;
      if (!value || typeof value.text !== 'string') continue;
      // Keep even an empty response: it proves injection worked, which lets the
      // caller show "no text selected" instead of "page blocked extensions".
      if (best === null || value.text.length > best.length) best = value.text;
    }
    return best;
  } catch {
    return null;
  }
}

async function captureSelection(tab: chrome.tabs.Tab | null): Promise<CaptureOutcome> {
  if (!tab) {
    const notice = captureNoticeForUrl(null);
    return {
      status: 'notice',
      code: notice?.code ?? 'no-active-tab',
      message: notice?.message ?? 'No active page was found.',
    };
  }

  const blocked = captureNoticeForUrl(tab.url);
  if (blocked) {
    return { status: 'notice', code: blocked.code, message: blocked.message };
  }
  if (tab.id === undefined) {
    const notice = captureNoticeForUrl(null);
    return {
      status: 'notice',
      code: notice?.code ?? 'no-active-tab',
      message: notice?.message ?? 'No active page was found.',
    };
  }

  let selection = await readFromContentScript(tab.id);
  if (selection === null) {
    selection = await readByInjection(tab.id);
    if (selection === null) {
      const notice = injectionBlockedNotice();
      return { status: 'notice', code: notice.code, message: notice.message };
    }
  } else if (!selection.trim()) {
    // The top frame had no selection, but a focused input or a selection in an
    // accessible iframe still might. Only replace an empty result with text,
    // never turn a successful empty read into an "injection blocked" notice.
    const injected = await readByInjection(tab.id);
    if (injected?.trim()) selection = injected;
  }

  const text = normalizeCapturedText(selection);
  if (!text.trim()) {
    const notice = emptySelectionNotice();
    return { status: 'notice', code: notice.code, message: notice.message };
  }

  return { status: 'ready', text };
}

async function closePreviousPopup(): Promise<void> {
  let previousId = popupWindowId;
  popupWindowId = null;
  try {
    const stored = await chrome.storage.session.get(POPUP_WINDOW_KEY);
    const storedId = stored[POPUP_WINDOW_KEY];
    if (typeof storedId === 'number') previousId = storedId;
    await chrome.storage.session.remove(POPUP_WINDOW_KEY);
  } catch {
    // Session storage is only used to remember the popup across worker restarts.
  }

  if (previousId !== null) {
    await chrome.windows.remove(previousId).catch(() => undefined);
  }
}

async function openCapturePopup(tab?: chrome.tabs.Tab | null): Promise<void> {
  let outcome: CaptureOutcome;
  try {
    const target = tab ?? (await getActiveTab());
    outcome = await captureSelection(target);
  } catch {
    outcome = {
      status: 'notice',
      code: 'unknown-error',
      message:
        'ClipCanvas could not read the selection on this page. Try selecting the text again, or copy it into a new note.',
    };
  }

  await closePreviousPopup();

  const id = crypto.randomUUID();
  const payload: CapturePopupPayload = {
    id,
    createdAt: new Date().toISOString(),
    ...(outcome.status === 'ready' ? { text: outcome.text } : { notice: outcome.message }),
  };

  try {
    await chrome.storage.session.set({ [CAPTURE_POPUP_KEY]: payload });
  } catch {
    // The popup will show its own "selection expired" message if this fails.
  }

  let left: number | undefined;
  let top: number | undefined;
  try {
    const current = await chrome.windows.getLastFocused();
    if (
      current.left !== undefined &&
      current.top !== undefined &&
      current.width !== undefined &&
      current.height !== undefined
    ) {
      left = Math.max(0, Math.round(current.left + (current.width - POPUP_WIDTH) / 2));
      top = Math.max(0, Math.round(current.top + (current.height - POPUP_HEIGHT) / 2));
    }
  } catch {
    // Fall back to the browser's default popup placement.
  }

  try {
    const created = await chrome.windows.create({
      url: chrome.runtime.getURL(`popup.html?id=${encodeURIComponent(id)}`),
      type: 'popup',
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      ...(left !== undefined && top !== undefined ? { left, top } : {}),
      focused: true,
    });
    popupWindowId = created?.id ?? null;
    if (popupWindowId !== null) {
      await chrome.storage.session
        .set({ [POPUP_WINDOW_KEY]: popupWindowId })
        .catch(() => undefined);
    }
  } catch {
    await clearCapturePopup();
  }
}

function setUpContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CAPTURE_MENU_ID,
      title: 'Save Selection to ClipCanvas',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);
});

// Refresh menu titles and IDs whenever the worker starts, including
// development reloads that do not fire onInstalled.
setUpContextMenus();

chrome.action.onClicked.addListener((tab) => {
  // The toolbar button opens the notebook only. Captures use the dedicated
  // Save Selection popup instead of pulling the side panel open.
  openPanel(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CAPTURE_MENU_ID) return;
  void openCapturePopup(tab ?? null);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    if (popupWindowId === windowId) popupWindowId = null;
    try {
      const stored = await chrome.storage.session.get(POPUP_WINDOW_KEY);
      if (stored[POPUP_WINDOW_KEY] !== windowId) return;
      await chrome.storage.session.remove([POPUP_WINDOW_KEY, CAPTURE_POPUP_KEY]);
    } catch {
      // Nothing else needs cleanup.
    }
  })();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;
  const type = (message as { type?: unknown }).type;

  if (type === CAPTURE_INSERT) {
    void getActiveTab()
      .then((tab) => captureSelection(tab ?? null))
      .then((outcome) => sendResponse({ outcome } satisfies CaptureInsertResponse))
      .catch(() => sendResponse({ outcome: null } satisfies CaptureInsertResponse));
    return true;
  }

  return undefined;
});
