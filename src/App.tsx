import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import {
  DEFAULT_NOTE_WIDTH_DEFAULT,
  type Canvas,
  type ImportResult,
  type NoteInsertion,
} from './types';
import { classNames, noteDisplayTitle, titleFromSelection } from './lib/utils';
import { compressImage } from './lib/images';
import { plainTextToHtml, textFromHtmlWithBreaks } from './lib/richText';
import { createAttachment } from './services/db/attachments';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useWorkspace } from './hooks/useWorkspace';
import { useInsertSelection } from './hooks/useInsertSelection';
import { useNotebook } from './state/NotebookContext';
import { useToast } from './state/ToastContext';
import { Sidebar, type NoteMenuAction } from './components/Sidebar';
import { CanvasTabs } from './components/CanvasTabs';
import { CanvasDialog } from './components/CanvasDialog';
import { CanvasView } from './components/CanvasView';
import { MoveNoteDialog } from './components/MoveNoteDialog';
import { ConfirmDialog } from './components/Dialog';
import { Button } from './components/Button';
import { HomeView } from './views/HomeView';
import { SettingsView } from './views/SettingsView';
import { Brand } from './components/Brand';

export default function App() {
  const notebook = useNotebook();
  const { data, loading, loadError, retryLoad } = notebook;
  const { notify } = useToast();
  const isMobile = useMediaQuery('(max-width: 720px)');
  const notes = data?.notes ?? [];
  const canvases = data?.canvases ?? [];
  const defaultNoteWidth = data?.settings.defaultNoteWidth ?? DEFAULT_NOTE_WIDTH_DEFAULT;
  const workspace = useWorkspace(data?.canvases ?? null, data?.notes ?? null);
  const insertSelection = useInsertSelection();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [canvasDialogOpen, setCanvasDialogOpen] = useState(false);
  const [canvasSearchOpen, setCanvasSearchOpen] = useState(false);
  const [noteAction, setNoteAction] = useState<{
    noteId: string;
    action: NoteMenuAction;
  } | null>(null);
  const [canvasToDeleteId, setCanvasToDeleteId] = useState<string | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);
  const [deletingCanvas, setDeletingCanvas] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const creatingNoteRef = useRef(false);
  const creatingEmptyNoteRef = useRef(false);
  const [insertion, setInsertion] = useState<NoteInsertion | null>(null);
  const [pendingEmptyNoteIds, setPendingEmptyNoteIds] = useState<Set<string>>(new Set());
  const [savingNoteIds, setSavingNoteIds] = useState<Set<string>>(() => new Set());
  const searchCanvasIdRef = useRef<string | null>(null);
  const requestedCanvasId = useMemo(
    () => new URLSearchParams(window.location.search).get('canvas'),
    [],
  );
  const requestedCanvasHandledRef = useRef(false);

  const openCanvases = useMemo(
    () =>
      workspace.openCanvasIds
        .map((id) => canvases.find((canvas) => canvas.id === id))
        .filter((canvas): canvas is Canvas => Boolean(canvas)),
    [canvases, workspace.openCanvasIds],
  );
  const activeCanvas = useMemo(
    () => canvases.find((canvas) => canvas.id === workspace.activeCanvasId) ?? null,
    [canvases, workspace.activeCanvasId],
  );
  const activeNote = useMemo(
    () =>
      workspace.view === 'canvas' && activeCanvas
        ? notes.find(
            (note) => note.id === workspace.activeNoteId && note.canvasId === activeCanvas.id,
          ) ?? null
        : null,
    [activeCanvas, notes, workspace.activeNoteId, workspace.view],
  );
  const activeCanvasId = activeCanvas?.id ?? null;
  const canvasNotes = useMemo(
    () => (activeCanvasId ? notes.filter((note) => note.canvasId === activeCanvasId) : []),
    [activeCanvasId, notes],
  );
  const pendingCanvasIds = useMemo(() => {
    if (savingNoteIds.size === 0) return new Set<string>();
    const ids = new Set<string>();
    for (const note of notes) {
      if (savingNoteIds.has(note.id)) ids.add(note.canvasId);
    }
    return ids;
  }, [notes, savingNoteIds]);
  const activeNoteForAction = noteAction
    ? notes.find((note) => note.id === noteAction.noteId) ?? null
    : null;
  const canvasToDelete = canvasToDeleteId
    ? canvases.find((canvas) => canvas.id === canvasToDeleteId) ?? null
    : null;

  const noteCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const note of notes) map.set(note.canvasId, (map.get(note.canvasId) ?? 0) + 1);
    return map;
  }, [notes]);

  const sidebarVisible = !data ? false : isMobile ? mobileSidebarOpen : !data.settings.sidebarCollapsed;
  const showSidebarButton = isMobile || Boolean(data?.settings.sidebarCollapsed);

  useEffect(() => {
    const activeCanvasId = activeCanvas?.id ?? null;
    if (searchCanvasIdRef.current !== activeCanvasId) {
      searchCanvasIdRef.current = activeCanvasId;
      setCanvasSearchOpen(false);
    }
    if (!activeCanvas || workspace.view !== 'canvas') setCanvasSearchOpen(false);
  }, [activeCanvas?.id, workspace.view]);

  useEffect(() => {
    // Empty notes created by double-clicking the canvas only survive once they
    // contain real text, so trim the transient set as soon as content arrives.
    setPendingEmptyNoteIds((current) => {
      if (current.size === 0) return current;
      const next = new Set<string>();
      for (const id of current) {
        const note = notes.find((item) => item.id === id);
        if (!note) continue;
        if (!(note.contentText ?? '').trim() && !(note.contentHtml ?? '').replace(/<[^>]*>/g, '').trim()) {
          next.add(id);
        }
      }
      if (next.size === current.size) return current;
      return next;
    });
  }, [notes]);

  const closeSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarOpen(false);
      return;
    }
    void notebook.updateSettings({ sidebarCollapsed: true }).catch((error: unknown) => {
      notify({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The sidebar preference could not be saved.',
      });
    });
  }, [isMobile, notebook, notify]);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarOpen((current) => !current);
      return;
    }
    if (!data) return;
    void notebook
      .updateSettings({ sidebarCollapsed: !data.settings.sidebarCollapsed })
      .catch((error: unknown) => {
        notify({
          kind: 'error',
          message: error instanceof Error ? error.message : 'The sidebar preference could not be saved.',
        });
      });
  }, [data, isMobile, notebook, notify]);

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  const openNote = useCallback(
    (noteId: string) => {
      workspace.openNote(noteId);
      closeMobileSidebar();
    },
    [closeMobileSidebar, workspace],
  );

  const activateCanvasNote = useCallback(
    (noteId: string) => {
      const note = notes.find((item) => item.id === noteId);
      // Selecting an element on the canvas must not re-center the viewport.
      workspace.selectNote(noteId, note?.kind !== 'image', undefined, false);
    },
    [notes, workspace],
  );

  const openCanvas = useCallback(
    (canvasId: string) => {
      workspace.openCanvas(canvasId);
      closeMobileSidebar();
    },
    [closeMobileSidebar, workspace],
  );

  const openUtility = useCallback(
    (view: 'search' | 'settings') => {
      workspace.openUtility(view);
      closeMobileSidebar();
    },
    [closeMobileSidebar, workspace],
  );

  const openCanvasSearch = useCallback(() => {
    if (!activeCanvas) {
      notify({
        kind: 'info',
        message: 'Open a canvas first to search inside it.',
      });
      return;
    }
    if (workspace.view !== 'canvas') workspace.returnToCanvases();
    setCanvasSearchOpen(true);
    closeMobileSidebar();
  }, [activeCanvas, closeMobileSidebar, notify, workspace]);

  const handleCreateNote = useCallback(
    async (canvasId?: string) => {
      if (creatingNoteRef.current) return;
      const target = canvasId
        ? canvases.find((canvas) => canvas.id === canvasId) ?? null
        : activeCanvas;
      if (!target) {
        notify({
          kind: 'info',
          message: 'Create a canvas first, then you can add notes to it.',
        });
        return;
      }
      creatingNoteRef.current = true;
      setCreatingNote(true);
      try {
        const note = await notebook.createNote({
          projectId: target.projectId,
          canvasId: target.id,
          title: '',
          content: '',
        });
        workspace.selectNote(note.id, true, note.canvasId);
        workspace.requestEdit(note.id);
        closeMobileSidebar();
      } catch (error) {
        notify({
          kind: 'error',
          message: error instanceof Error ? error.message : 'A new note could not be created.',
        });
      } finally {
        creatingNoteRef.current = false;
        setCreatingNote(false);
      }
    },
    [activeCanvas, canvases, closeMobileSidebar, notebook, notify, workspace],
  );

  const handleCanvasEmptyNote = useCallback(
    async (
      position: { x: number; y: number },
      options?: { anchor?: { x: number; y: number } },
    ) => {
      if (!activeCanvas) return;
      if (creatingEmptyNoteRef.current) return;
      creatingEmptyNoteRef.current = true;
      const topZ = canvasNotes.reduce(
        (highest, note) => Math.max(highest, note.layout?.zIndex ?? 0),
        0,
      );
      try {
        const note = await notebook.createNote({
          projectId: activeCanvas.projectId,
          canvasId: activeCanvas.id,
          title: '',
          content: '',
          layout: {
            x: Math.round(position.x),
            y: Math.round(position.y),
            width: defaultNoteWidth,
            height: 180,
            zIndex: topZ + 1,
            widthLocked: false,
          },
        });
        setPendingEmptyNoteIds((current) => new Set(current).add(note.id));
        // The element was created exactly where the user double-clicked, so
        // revealing it would only move the canvas away from that spot.
        workspace.selectNote(note.id, true, note.canvasId, false);
        workspace.requestEdit(note.id, {
          zoom: true,
          anchor: options?.anchor,
        });
      } catch (error) {
        notify({
          kind: 'error',
          message: error instanceof Error ? error.message : 'A new text element could not be created.',
        });
      } finally {
        creatingEmptyNoteRef.current = false;
      }
    },
    [activeCanvas, canvasNotes, defaultNoteWidth, notebook, notify, workspace],
  );

  const handleNoteSaveStatusChange = useCallback((noteId: string, pending: boolean) => {
    setSavingNoteIds((current) => {
      if (current.has(noteId) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(noteId);
      else next.delete(noteId);
      return next;
    });
  }, []);

  const handleDiscardEmptyNote = useCallback(
    async (noteId: string) => {
      setPendingEmptyNoteIds((current) => {
        if (!current.has(noteId)) return current;
        const next = new Set(current);
        next.delete(noteId);
        return next;
      });
      try {
        await notebook.deleteNote(noteId);
        if (workspace.activeNoteId === noteId) workspace.clearActiveNote();
      } catch {
        // The note may already have been removed by another action.
      }
    },
    [notebook, workspace],
  );

  const handleCanvasImage = useCallback(
    async (file: File, position: { x: number; y: number }) => {
      if (!activeCanvas) return;
      try {
        const image = await compressImage(file);
        const noteWidth = defaultNoteWidth;
        const imageHeight = Math.round((noteWidth / image.width) * image.height);
        const noteHeight = Math.max(80, imageHeight);
        const topZ = canvasNotes.reduce(
          (highest, note) => Math.max(highest, note.layout?.zIndex ?? 0),
          0,
        );
        const note = await notebook.createNote({
          projectId: activeCanvas.projectId,
          canvasId: activeCanvas.id,
          title: '',
          kind: 'image',
          content: '',
          layout: {
            x: Math.round(position.x - noteWidth / 2),
            y: Math.round(position.y - noteHeight / 2),
            width: noteWidth,
            height: noteHeight,
            zIndex: topZ + 1,
            widthLocked: false,
          },
        });
        try {
          const attachment = await createAttachment({
            noteId: note.id,
            projectId: activeCanvas.projectId,
            blob: image.blob,
            width: image.width,
            height: image.height,
            mimeType: image.mimeType,
          });
          const html = `<img data-attachment-id="${attachment.id}" alt="Pasted image" width="${noteWidth}" />`;
          await notebook.updateNote(note.id, {
            content: '',
            contentHtml: html,
            contentText: '',
          });
        } catch (error) {
          await notebook.deleteNote(note.id).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        notify({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The image could not be added to the canvas.',
        });
      }
    },
    [activeCanvas, canvasNotes, defaultNoteWidth, notebook, notify],
  );

  const handleCanvasText = useCallback(
    async (
      text: string,
      position: { x: number; y: number },
      html?: string,
    ) => {
      if (!activeCanvas) return;
      const richHtml = html?.trim() ?? '';
      const content = (text.trim() || textFromHtmlWithBreaks(richHtml)).trim();
      const contentHtml = richHtml || plainTextToHtml(content);
      if (!content && !contentHtml) return;
      try {
        const topZ = canvasNotes.reduce(
          (highest, note) => Math.max(highest, note.layout?.zIndex ?? 0),
          0,
        );
        const width = defaultNoteWidth;
        await notebook.createNote({
          projectId: activeCanvas.projectId,
          canvasId: activeCanvas.id,
          title: titleFromSelection(content),
          content,
          ...(contentHtml ? { contentHtml, contentText: content } : {}),
          layout: {
            x: Math.round(position.x),
            y: Math.round(position.y),
            width,
            height: 340,
            zIndex: topZ + 1,
            widthLocked: false,
          },
        });
      } catch (error) {
        notify({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The pasted text could not be added to the canvas.',
        });
      }
    },
    [activeCanvas, canvasNotes, defaultNoteWidth, notebook, notify],
  );

  const handleNewCanvas = useCallback(() => {
    setCanvasDialogOpen(true);
  }, []);

  const handleInsertSelection = useCallback(async () => {
    if (!activeNote) {
      notify({
        kind: 'info',
        message: 'Select an element first, then insert the selection into it.',
      });
      return;
    }
    const text = await insertSelection.requestInsertSelection();
    if (!text) return;
    setInsertion({
      noteId: activeNote.id,
      text,
      nonce: Date.now(),
    });
    notify({ kind: 'success', message: 'Selection inserted into the selected element.' });
  }, [activeNote, insertSelection, notify]);

  const handleInsertionApplied = useCallback((nonce: number) => {
    setInsertion((current) => (current?.nonce === nonce ? null : current));
  }, []);

  const handleNoteAction = useCallback(
    (noteId: string, action: NoteMenuAction) => {
      if (action === 'rename') {
        workspace.openNote(noteId);
        workspace.requestTitleFocus(noteId);
        closeMobileSidebar();
        return;
      }
      setNoteAction({ noteId, action });
    },
    [closeMobileSidebar, workspace],
  );

  const handleDeleteNote = async () => {
    if (!activeNoteForAction || deletingNote) return;
    setDeletingNote(true);
    try {
      await notebook.deleteNote(activeNoteForAction.id);
      if (workspace.activeNoteId === activeNoteForAction.id) workspace.clearActiveNote();
      notify({ kind: 'success', message: 'Note deleted.' });
      setNoteAction(null);
    } catch (error) {
      notify({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The note could not be deleted.',
      });
    } finally {
      setDeletingNote(false);
    }
  };

  const handleDeleteCanvas = async () => {
    if (!canvasToDelete || deletingCanvas) return;
    setDeletingCanvas(true);
    try {
      const result = await notebook.deleteCanvas(canvasToDelete.id);
      workspace.closeTab(canvasToDelete.id);
      if (workspace.activeNoteId && result.deletedNoteIds.includes(workspace.activeNoteId)) {
        workspace.clearActiveNote();
      }
      notify({ kind: 'success', message: `Canvas “${canvasToDelete.name}” deleted.` });
      setCanvasToDeleteId(null);
    } catch (error) {
      notify({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The canvas could not be deleted.',
      });
    } finally {
      setDeletingCanvas(false);
    }
  };

  const handleImported = (_result: ImportResult) => {
    if (workspace.openCanvasIds.length === 0) workspace.returnToCanvases();
  };

  useEffect(() => {
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!workspace.loaded) return;

    // A full-tab instance receives the canvas that was active in the side
    // panel. Opening that exact canvas prevents the shared workspace state
    // from selecting a different, more recently updated canvas.
    if (
      requestedCanvasId &&
      canvases.length > 0 &&
      !requestedCanvasHandledRef.current
    ) {
      requestedCanvasHandledRef.current = true;
      if (canvases.some((canvas) => canvas.id === requestedCanvasId)) {
        if (workspace.activeCanvasId !== requestedCanvasId) {
          workspace.openCanvas(requestedCanvasId);
        }
        return;
      }
    }

    if (workspace.activeCanvasId && canvases.some((canvas) => canvas.id === workspace.activeCanvasId)) {
      return;
    }
    const next = [...canvases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (next) workspace.openCanvas(next.id);
  }, [
    canvases,
    requestedCanvasId,
    workspace.activeCanvasId,
    workspace.loaded,
    workspace.openCanvas,
  ]);

  if (loading || (data && !workspace.loaded)) {
    return (
      <div className="boot-screen">
        <Brand />
        <div className="boot-loader" role="status" aria-live="polite">
          <span className="boot-spinner" aria-hidden="true" />
          <span>Opening your notebook…</span>
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="boot-screen boot-error">
        <Brand />
        <div className="boot-error-card">
          <AlertCircle size={22} aria-hidden="true" />
          <h1>Your notebook could not be opened</h1>
          <p>{loadError ?? 'The local notebook database is unavailable.'}</p>
          <Button variant="primary" icon={<RefreshCw size={15} />} onClick={retryLoad}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {sidebarVisible ? (
        <Sidebar
          notes={notes}
          canvases={canvases}
          activeNoteId={activeNote?.id ?? null}
          activeCanvasId={activeCanvas?.id ?? null}
          view={workspace.view}
          isMobile={isMobile}
          onClose={closeSidebar}
          onOpenSettings={() => openUtility('settings')}
          onCreateCanvas={handleNewCanvas}
          onOpenCanvas={openCanvas}
          onOpenNote={openNote}
          onCanvasAction={(canvasId, action) => {
            if (action === 'delete') setCanvasToDeleteId(canvasId);
          }}
          onNoteAction={handleNoteAction}
        />
      ) : null}

      {isMobile && mobileSidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <main className={classNames('workspace', !sidebarVisible && 'is-sidebar-hidden')}>
        <CanvasTabs
          canvases={openCanvases}
          activeCanvasId={activeCanvas?.id ?? null}
          view={workspace.view}
          showSidebarButton={showSidebarButton}
          pendingCanvasIds={pendingCanvasIds}
          onToggleSidebar={toggleSidebar}
          onSelectTab={(canvasId) => {
            workspace.selectCanvas(canvasId);
            closeMobileSidebar();
          }}
          onCloseTab={workspace.closeTab}
          onNewCanvas={handleNewCanvas}
          onSearch={openCanvasSearch}
        />

        <div className="workspace-content">
          {workspace.view === 'settings' ? (
            <SettingsView onClose={workspace.returnToCanvases} onImported={handleImported} />
          ) : activeCanvas ? (
            <CanvasView
              canvas={activeCanvas}
              notes={canvasNotes}
              settings={data.settings}
              activeNoteId={activeNote?.id ?? null}
              insertion={insertion?.noteId === activeNote?.id ? insertion : null}
              revealRequest={workspace.revealRequest}
              editRequest={workspace.editRequest}
              searchOpen={canvasSearchOpen}
              onSearchClose={() => setCanvasSearchOpen(false)}
              discardEmptyNoteIds={pendingEmptyNoteIds}
              onUpdateNote={notebook.updateNote}
              onNoteSaveStatusChange={handleNoteSaveStatusChange}
              onInsertSelection={() => void handleInsertSelection()}
              onInsertionApplied={handleInsertionApplied}
              onNoteAction={(noteId, action) => setNoteAction({ noteId, action })}
              onActivate={activateCanvasNote}
              onAddNote={() => void handleCreateNote(activeCanvas.id)}
              onCanvasImage={(file, position) => void handleCanvasImage(file, position)}
              onCanvasText={(text, position) => void handleCanvasText(text, position)}
              onCanvasEmptyNote={(position, options) =>
                void handleCanvasEmptyNote(position, options)
              }
              onDiscardEmptyNote={(noteId) => void handleDiscardEmptyNote(noteId)}
              onDeselectNote={workspace.clearActiveNote}
              onViewportChange={notebook.updateCanvasViewport}
              onNoteLayoutChange={notebook.updateNoteLayout}
            />
          ) : (
            <HomeView
              notes={notes}
              canvases={canvases}
              onCreateCanvas={handleNewCanvas}
              onOpenCanvas={openCanvas}
              onOpenNote={openNote}
              onOpenSearch={openCanvasSearch}
            />
          )}
        </div>
      </main>

      <CanvasDialog
        open={canvasDialogOpen}
        projectId={activeCanvas?.projectId ?? null}
        onClose={() => setCanvasDialogOpen(false)}
        onSaved={(canvas) => {
          workspace.openCanvas(canvas.id);
          closeMobileSidebar();
        }}
      />

      <ConfirmDialog
        open={Boolean(activeNoteForAction && noteAction?.action === 'delete')}
        title={activeNoteForAction ? `Delete “${noteDisplayTitle(activeNoteForAction)}”?` : 'Delete note?'}
        description="The note and its content will be permanently removed. Closing a canvas tab never deletes a note."
        confirmLabel="Delete note"
        busy={deletingNote}
        onClose={() => {
          if (!deletingNote) setNoteAction(null);
        }}
        onConfirm={() => void handleDeleteNote()}
      />

      <ConfirmDialog
        open={Boolean(canvasToDelete)}
        title={canvasToDelete ? `Delete canvas “${canvasToDelete.name}”?` : 'Delete canvas?'}
        description={
          canvasToDelete
            ? `This permanently removes the canvas and its ${
                noteCounts.get(canvasToDelete.id) ?? 0
              } ${
                (noteCounts.get(canvasToDelete.id) ?? 0) === 1 ? 'element' : 'elements'
              }, including any images stored with them. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete canvas"
        busy={deletingCanvas}
        onClose={() => {
          if (!deletingCanvas) setCanvasToDeleteId(null);
        }}
        onConfirm={() => void handleDeleteCanvas()}
      />

      <MoveNoteDialog
        open={Boolean(activeNoteForAction && noteAction?.action === 'move')}
        note={activeNoteForAction}
        canvases={canvases}
        noteCounts={noteCounts}
        onClose={() => setNoteAction(null)}
        onMoved={(moved) => {
          setNoteAction(null);
          workspace.selectNote(moved.id, true, moved.canvasId);
        }}
        onCreateCanvas={() => {
          setNoteAction(null);
          handleNewCanvas();
        }}
      />

      {creatingNote ? (
        <div className="global-busy" role="status" aria-live="polite">
          Creating note…
        </div>
      ) : null}
    </div>
  );
}
