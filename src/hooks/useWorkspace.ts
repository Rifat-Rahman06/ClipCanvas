import { useCallback, useEffect, useRef, useState } from 'react';
import type { Canvas, Note, WorkspaceState } from '../types';
import { loadWorkspaceState, saveWorkspaceState } from '../services/workspace/workspaceStorage';

export type WorkspaceView = 'canvas' | 'search' | 'settings';

interface FocusRequest {
  noteId: string;
  nonce: number;
}

interface EditRequest extends FocusRequest {
  zoom?: boolean;
  anchor?: { x: number; y: number };
}

const EMPTY_WORKSPACE: WorkspaceState = {
  openCanvasIds: [],
  activeCanvasId: null,
  activeProjectId: null,
  activeNoteId: null,
};

export function useWorkspace(canvases: Canvas[] | null, notes: Note[] | null) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY_WORKSPACE);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<WorkspaceView>('canvas');
  const [titleFocus, setTitleFocus] = useState<FocusRequest | null>(null);
  const [revealRequest, setRevealRequest] = useState<FocusRequest | null>(null);
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceState().then((state) => {
      if (cancelled) return;
      setWorkspace(state);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded || canvases === null || notes === null) return;
    const availableCanvases = new Map(canvases.map((canvas) => [canvas.id, canvas]));
    const availableNotes = new Map(notes.map((note) => [note.id, note]));
    setWorkspace((current) => {
      const openCanvasIds = current.openCanvasIds.filter((id) => availableCanvases.has(id));
      const activeCanvasId =
        current.activeCanvasId && availableCanvases.has(current.activeCanvasId)
          ? current.activeCanvasId
          : (openCanvasIds.at(-1) ?? null);
      const activeCanvas = activeCanvasId ? availableCanvases.get(activeCanvasId) : null;
      const activeNote =
        current.activeNoteId && activeCanvas
          ? availableNotes.get(current.activeNoteId)
          : null;
      const activeNoteId =
        activeNote && activeNote.canvasId === activeCanvasId ? activeNote.id : null;
      const activeProjectId =
        activeCanvas?.projectId ??
        (activeNote ? activeNote.projectId : null) ??
        current.activeProjectId;
      if (
        openCanvasIds.length === current.openCanvasIds.length &&
        activeCanvasId === current.activeCanvasId &&
        activeNoteId === current.activeNoteId &&
        activeProjectId === current.activeProjectId
      ) {
        return current;
      }
      return { openCanvasIds, activeCanvasId, activeProjectId, activeNoteId };
    });
  }, [canvases, loaded, notes]);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveWorkspaceState(workspace);
    }, 180);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [loaded, workspace]);

  const openCanvas = useCallback((canvasId: string) => {
    const canvas = canvases?.find((item) => item.id === canvasId) ?? null;
    setWorkspace((current) => ({
      openCanvasIds: current.openCanvasIds.includes(canvasId)
        ? current.openCanvasIds
        : [...current.openCanvasIds, canvasId],
      activeCanvasId: canvasId,
      activeProjectId: canvas?.projectId ?? current.activeProjectId,
      activeNoteId: null,
    }));
    setRevealRequest(null);
    setView('canvas');
  }, [canvases]);

  const selectCanvas = useCallback((canvasId: string) => {
    const canvas = canvases?.find((item) => item.id === canvasId) ?? null;
    setWorkspace((current) =>
      current.openCanvasIds.includes(canvasId)
        ? {
            ...current,
            activeCanvasId: canvasId,
            activeProjectId: canvas?.projectId ?? current.activeProjectId,
            activeNoteId: null,
          }
        : current,
    );
    setView('canvas');
  }, [canvases]);

  const openProject = useCallback(
    (projectId: string) => {
      const projectCanvases = (canvases ?? [])
        .filter((canvas) => canvas.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const first = projectCanvases[0];
      if (first) {
        openCanvas(first.id);
        return;
      }
      setWorkspace((current) => ({
        ...current,
        activeCanvasId: null,
        activeProjectId: projectId,
        activeNoteId: null,
      }));
      setRevealRequest(null);
      setView('canvas');
    },
    [canvases, openCanvas],
  );

  const selectNote = useCallback(
    (noteId: string, openTab = true, canvasIdOverride?: string, reveal = true) => {
      const note = notes?.find((item) => item.id === noteId) ?? null;
      const canvasId = canvasIdOverride ?? note?.canvasId ?? null;
      const canvas = canvasId
        ? canvases?.find((item) => item.id === canvasId) ?? null
        : null;
      if (!canvas) return;
      setWorkspace((current) => ({
        openCanvasIds:
          openTab && !current.openCanvasIds.includes(canvas.id)
            ? [...current.openCanvasIds, canvas.id]
            : current.openCanvasIds,
        activeCanvasId: canvas.id,
        activeProjectId: canvas.projectId,
        activeNoteId: noteId,
      }));
      // Clicking an element on the canvas should not move the viewport; the
      // reveal request is only for opening a note from outside the canvas.
      if (reveal) {
        setRevealRequest((current) => ({ noteId, nonce: (current?.nonce ?? 0) + 1 }));
      }
      setView('canvas');
    },
    [canvases, notes],
  );

  const openNote = selectNote;

  const closeTab = useCallback(
    (canvasId: string) => {
      setWorkspace((current) => {
        const index = current.openCanvasIds.indexOf(canvasId);
        if (index < 0) return current;
        const openCanvasIds = current.openCanvasIds.filter((id) => id !== canvasId);
        let activeCanvasId = current.activeCanvasId;
        if (current.activeCanvasId === canvasId) {
          activeCanvasId = openCanvasIds[Math.max(0, index - 1)] ?? openCanvasIds[0] ?? null;
        }
        const activeCanvas = activeCanvasId
          ? canvases?.find((canvas) => canvas.id === activeCanvasId) ?? null
          : null;
        return {
          openCanvasIds,
          activeCanvasId,
          activeProjectId: activeCanvas?.projectId ?? current.activeProjectId,
          activeNoteId: activeCanvasId ? current.activeNoteId : null,
        };
      });
    },
    [canvases],
  );

  const clearActiveNote = useCallback(() => {
    setWorkspace((current) => ({ ...current, activeNoteId: null }));
  }, []);

  const requestTitleFocus = useCallback((noteId: string) => {
    setTitleFocus((current) => ({ noteId, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const requestEdit = useCallback(
    (noteId: string, options?: { zoom?: boolean; anchor?: { x: number; y: number } }) => {
      setEditRequest((current) => ({
        noteId,
        nonce: (current?.nonce ?? 0) + 1,
        ...options,
      }));
    },
    [],
  );

  const openUtility = useCallback((next: Exclude<WorkspaceView, 'canvas'>) => {
    setView(next);
  }, []);

  const returnToCanvases = useCallback(() => {
    setView('canvas');
  }, []);

  return {
    loaded,
    openCanvasIds: workspace.openCanvasIds,
    activeCanvasId: workspace.activeCanvasId,
    activeNoteId: workspace.activeNoteId,
    activeProjectId: workspace.activeProjectId,
    view,
    titleFocus,
    revealRequest,
    editRequest,
    openCanvas,
    openProject,
    selectCanvas,
    selectNote,
    openNote,
    clearActiveNote,
    closeTab,
    requestTitleFocus,
    requestEdit,
    openUtility,
    returnToCanvases,
  };
}
