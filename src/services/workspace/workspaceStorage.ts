import type { WorkspaceState } from '../../types';
import { unique } from '../../lib/utils';

const WORKSPACE_KEY = 'clipcanvas.workspace.v2';
const LEGACY_WORKSPACE_KEY = 'folio.workspace.v2';

function emptyWorkspace(): WorkspaceState {
  return {
    openCanvasIds: [],
    activeCanvasId: null,
    activeProjectId: null,
    activeNoteId: null,
  };
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function loadWorkspaceState(): Promise<WorkspaceState> {
  if (!hasChromeStorage()) return emptyWorkspace();
  try {
    const result = await chrome.storage.local.get([WORKSPACE_KEY, LEGACY_WORKSPACE_KEY]);
    const raw = (result[WORKSPACE_KEY] ?? result[LEGACY_WORKSPACE_KEY]) as
      | Partial<WorkspaceState>
      | undefined;
    if (!raw) return emptyWorkspace();
    const openCanvasIds = Array.isArray(raw.openCanvasIds)
      ? unique(raw.openCanvasIds.filter((id): id is string => typeof id === 'string'))
      : [];
    const activeCanvasId =
      typeof raw.activeCanvasId === 'string' && openCanvasIds.includes(raw.activeCanvasId)
        ? raw.activeCanvasId
        : (openCanvasIds.at(-1) ?? null);
    const activeProjectId =
      typeof raw.activeProjectId === 'string' ? raw.activeProjectId : null;
    const activeNoteId =
      typeof raw.activeNoteId === 'string' ? raw.activeNoteId : null;
    return { openCanvasIds, activeCanvasId, activeProjectId, activeNoteId };
  } catch {
    return emptyWorkspace();
  }
}

export async function saveWorkspaceState(state: WorkspaceState): Promise<void> {
  if (!hasChromeStorage()) return;
  try {
    await chrome.storage.local.set({ [WORKSPACE_KEY]: state });
  } catch {
    // Tab layout is a convenience; notebook data has already been persisted.
  }
}
