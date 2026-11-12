import { useCallback } from 'react';
import type { CaptureOutcome } from '../types';
import {
  CAPTURE_INSERT,
  type CaptureInsertResponse,
} from '../services/capture/messages';
import { useToast } from '../state/ToastContext';

function hasRuntime(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
}

export function useInsertSelection() {
  const { notify } = useToast();

  const requestInsertSelection = useCallback(async (): Promise<string | null> => {
    if (!hasRuntime()) {
      notify({
        kind: 'error',
        message: 'ClipCanvas can only read page selections when it is running as a Chrome extension.',
      });
      return null;
    }

    let outcome: CaptureOutcome | null = null;
    try {
      const response = (await chrome.runtime.sendMessage({
        type: CAPTURE_INSERT,
      })) as CaptureInsertResponse | undefined;
      outcome = response?.outcome ?? null;
    } catch {
      // Handled below with the same message as an unreachable page.
    }

    if (!outcome) {
      notify({
        kind: 'warning',
        message:
          'ClipCanvas could not reach the active page. Select text on the page, then try again.',
      });
      return null;
    }

    if (outcome.status === 'ready') return outcome.text;

    notify({
      kind: outcome.code === 'empty-selection' ? 'info' : 'warning',
      message: outcome.message,
      duration: 9000,
    });
    return null;
  }, [notify]);

  return { requestInsertSelection };
}
