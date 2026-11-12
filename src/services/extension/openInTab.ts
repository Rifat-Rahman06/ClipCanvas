interface OpenClipCanvasOptions {
  canvasId?: string | null;
}

export async function openClipCanvasInTab(options: OpenClipCanvasOptions = {}): Promise<void> {
  const params = new URLSearchParams();
  if (options.canvasId) params.set('canvas', options.canvasId);
  const query = params.toString();
  const url = `${chrome.runtime.getURL('index.html')}${query ? `?${query}` : ''}`;

  const currentWindow = await chrome.windows.getCurrent().catch(() => null);
  const windowId = currentWindow?.id;
  const canCloseSidePanel = typeof chrome.sidePanel?.close === 'function';
  const previousTab =
    canCloseSidePanel && windowId !== undefined
      ? (await chrome.tabs.query({ active: true, windowId }).catch(() => []))[0]
      : undefined;

  await chrome.tabs.create({
    url,
    active: true,
    ...(windowId !== undefined ? { windowId } : {}),
  });

  if (!canCloseSidePanel || windowId === undefined) return;

  // A tab-specific panel needs its current tab id. A global panel is closed
  // through the window. Trying both keeps older and newer Chrome versions
  // working because the unsupported form simply rejects.
  if (previousTab?.id !== undefined) {
    await chrome.sidePanel.close({ tabId: previousTab.id }).catch(() => undefined);
  }
  await chrome.sidePanel.close({ windowId }).catch(() => undefined);
}
