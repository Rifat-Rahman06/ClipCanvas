import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/react';
import { getAttachmentUrl } from '../services/db/attachments';
import type { Note, NoteInsertion, NotePatch, UpdateNoteOptions } from '../types';
import { classNames, noteDisplayTitle, titleFromContent } from '../lib/utils';
import { markdownToHtml } from '../lib/richText';
import { capturedTextToHtml } from '../lib/insertion';
import { useToast } from '../state/ToastContext';
import { RichTextEditor } from './editor/RichTextEditor';

export type NoteCardAction = 'move' | 'delete';

export interface EditAnchor {
  x: number;
  y: number;
}

export interface BeginEditOptions {
  zoom?: boolean;
  anchor?: EditAnchor;
}

interface NoteCardProps {
  note: Note;
  fontSize: number;
  autosaveDelayMs: number;
  canvasZoom: number;
  active: boolean;
  editing: boolean;
  resizing: boolean;
  dragging: boolean;
  insertion: NoteInsertion | null;
  discardWhenEmpty: boolean;
  onUpdateNote: (
    id: string,
    patch: NotePatch,
    options?: UpdateNoteOptions,
  ) => Promise<Note>;
  onNoteSaveStatusChange: (noteId: string, pending: boolean) => void;
  onInsertionApplied: (nonce: number) => void;
  onActivate: (noteId: string) => void;
  onBeginEdit: (noteId: string, options?: BeginEditOptions) => void;
  onBeginResize: (noteId: string) => void;
  onEditorReady: (noteId: string, editor: Editor | null) => void;
  onDiscardEmpty: (noteId: string) => void;
  /**
   * Called after every document or selection change while editing so the
   * canvas can keep the caret inside the visible area.
   */
  onCaretActivity: () => void;
}

export function NoteCard({
  note,
  fontSize,
  autosaveDelayMs,
  canvasZoom,
  active,
  editing,
  resizing,
  dragging,
  insertion,
  discardWhenEmpty,
  onUpdateNote,
  onNoteSaveStatusChange,
  onInsertionApplied,
  onActivate,
  onBeginEdit,
  onBeginResize,
  onEditorReady,
  onDiscardEmpty,
  onCaretActivity,
}: NoteCardProps) {
  const { notify } = useToast();
  const onCaretActivityRef = useRef(onCaretActivity);
  onCaretActivityRef.current = onCaretActivity;
  const editorRef = useRef<Editor | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const initialHtml = note.contentHtml ?? markdownToHtml(note.content);
  const [editorContent, setEditorContent] = useState(initialHtml);
  const contentRef = useRef({
    html: initialHtml,
    text: note.contentText ?? note.content,
  });
  const titleRef = useRef(note.title);
  const pendingRef = useRef<NotePatch>({});
  const saveTimerRef = useRef<number | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const [editorMounted, setEditorMounted] = useState(false);
  const clickTimerRef = useRef<number | null>(null);
  const editAnchorRef = useRef<EditAnchor | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const discardTimerRef = useRef<number | null>(null);
  const discardedRef = useRef(false);
  const hasBeenEditingRef = useRef(false);
  const reportedPendingRef = useRef(false);
  // True while the editor holds content that is persisted but not yet published
  // to the notebook's React state. Autosave writes to IndexedDB without
  // updating the canvas node tree; the final content is published when editing
  // ends so ProseMirror keeps ownership of the caret during the session.
  const localDirtyRef = useRef(false);
  const localRevisionRef = useRef(0);
  const insertAtEndRef = useRef(true);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const activeRef = useRef(active);
  activeRef.current = active;

  const clearDiscardTimer = useCallback(() => {
    if (discardTimerRef.current === null) return;
    window.clearTimeout(discardTimerRef.current);
    discardTimerRef.current = null;
  }, []);

  const reportSavePending = useCallback(
    (pending: boolean) => {
      if (reportedPendingRef.current === pending) return;
      reportedPendingRef.current = pending;
      onNoteSaveStatusChange(note.id, pending);
    },
    [note.id, onNoteSaveStatusChange],
  );

  useEffect(() => {
    discardedRef.current = false;
    hasBeenEditingRef.current = false;
    localDirtyRef.current = false;
    localRevisionRef.current += 1;
    insertAtEndRef.current = true;
    reportSavePending(false);
    clearDiscardTimer();
  }, [clearDiscardTimer, note.id, reportSavePending]);

  const scheduleDiscard = useCallback(
    (delay = 160) => {
      if (!discardWhenEmpty || note.kind === 'image' || discardedRef.current) return;
      clearDiscardTimer();
      discardTimerRef.current = window.setTimeout(() => {
        discardTimerRef.current = null;
        if (discardedRef.current) return;
        if (contentRef.current.text.trim()) return;
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        pendingRef.current = {};
        discardedRef.current = true;
        reportSavePending(false);
        onDiscardEmpty(note.id);
      }, delay);
    },
    [
      clearDiscardTimer,
      discardWhenEmpty,
      note.id,
      note.kind,
      onDiscardEmpty,
      reportSavePending,
    ],
  );

  useEffect(() => {
    if (editing) {
      hasBeenEditingRef.current = true;
      clearDiscardTimer();
      return;
    }
    // Only discard an untouched element once it is no longer selected. Losing
    // focus is not enough: switching to the page to select text for insertion
    // blurs the editor while the element is still the one being edited.
    if (hasBeenEditingRef.current && !active) scheduleDiscard(0);
  }, [active, clearDiscardTimer, editing, scheduleDiscard]);

  const handleEditorBlur = useCallback(() => {
    if (!activeRef.current) scheduleDiscard(180);
    // A stray focus change (clicking the element's padding, the React Flow
    // node wrapper gaining focus, the window losing OS focus, ...) must not
    // silently end the caret session. If editing is still active and focus did
    // not move to another control, put it back into the document.
    window.setTimeout(() => {
      if (!editingRef.current || !activeRef.current) return;
      const active = document.activeElement;
      if (active instanceof Element) {
        if (active.closest('.note-card, .note-anchored-toolbar')) return;
        if (
          active.closest('button, input, textarea, select, a, [contenteditable="true"]')
        ) {
          return;
        }
      }
      editorRef.current?.commands.focus(undefined, { scrollIntoView: false });
    }, 0);
  }, [scheduleDiscard]);

  useEffect(
    () => () => {
      clearDiscardTimer();
    },
    [clearDiscardTimer],
  );

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current === null) return;
    window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
  }, []);

  useEffect(() => () => clearClickTimer(), [clearClickTimer]);

  useEffect(() => {
    if (!active) clearClickTimer();
  }, [active, clearClickTimer]);

  useEffect(() => {
    if (editing) clearClickTimer();
  }, [editing, clearClickTimer]);

  useEffect(() => {
    if (!dragging) return;
    draggedRef.current = true;
    clearClickTimer();
  }, [dragging, clearClickTimer]);

  useEffect(() => {
    titleRef.current = note.title;
  }, [note.title]);

  useEffect(() => {
    if (!active || insertion?.noteId !== note.id) return;
    insertAtEndRef.current = !editorRef.current?.isFocused;
    setEditorMounted(true);
    onBeginEdit(note.id);
  }, [active, insertion, note.id, onBeginEdit]);

  useEffect(() => {
    if (editing) setEditorMounted(true);
  }, [editing]);

  useEffect(() => {
    if (!editing || !editor) return;
    const timer = window.setTimeout(() => {
      const anchor = editAnchorRef.current;
      editAnchorRef.current = null;
      if (anchor) {
        const position = editor.view.posAtCoords({
          left: anchor.x,
          top: anchor.y,
        });
        if (position) {
          editor
            .chain()
            .setTextSelection(position.pos)
            .focus(undefined, { scrollIntoView: false })
            .run();
          return;
        }
      }
      // Never jump an existing note to its end. Keeping the current selection
      // (the start for a new note) avoids the scroll-to-bottom that used to
      // make the first click feel like the editor had lost its place.
      editor.commands.focus(undefined, { scrollIntoView: false });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [editing, editor]);

  useEffect(() => {
    if (!editing) editAnchorRef.current = null;
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      editor?.commands.blur();
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      editor?.commands.blur();
      onBeginResize(note.id);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editing, editor, note.id, onBeginResize]);

  useEffect(() => {
    if (!editing || !editor) return;
    // ProseMirror reports edits, but native arrow/Home/End moves only reach its
    // state through `selectionchange`, which this browser does not dispatch for
    // a caret inside the transformed canvas. Keyboard events are the reliable
    // signal, so follow the caret in the next task, after the key's default
    // action has moved the selection. Deferring also collapses the burst of
    // `update`/`selectionUpdate` signals from one key into a single follow, and
    // lets a newly inserted empty paragraph get its caret laid out first.
    const followCaret = () => onCaretActivityRef.current();
    let timer = 0;
    const scheduleFollow = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        followCaret();
      }, 0);
    };
    const handleActivity = () => scheduleFollow();
    editor.on('update', handleActivity);
    editor.on('selectionUpdate', handleActivity);
    window.addEventListener('keydown', handleActivity, true);
    return () => {
      editor.off('update', handleActivity);
      editor.off('selectionUpdate', handleActivity);
      window.removeEventListener('keydown', handleActivity, true);
      if (timer) window.clearTimeout(timer);
    };
  }, [editing, editor]);

  useEffect(() => {
    // While editing, the TipTap document is the source of truth. Syncing the
    // saved note back into it can race with autosave and replace a freshly
    // inserted line, dropping focus and making the editor stop accepting input.
    // Persist-only autosaves also leave `note` behind the editor until the edit
    // session ends, so never let that stale snapshot overwrite newer local text.
    if (editing || localDirtyRef.current) return;
    if ('contentHtml' in pendingRef.current) return;
    const html = note.contentHtml ?? markdownToHtml(note.content);
    const text = note.contentText ?? note.content;
    if (html === contentRef.current.html && text === contentRef.current.text) return;
    contentRef.current = { html, text };
    setEditorContent(html);
  }, [editing, note.content, note.contentHtml, note.contentText]);

  const flush = useCallback(
    (options?: { publish?: boolean; includeLatestContent?: boolean }) => {
      if (discardedRef.current) return;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingRef.current;
      pendingRef.current = {};
      if (options?.includeLatestContent) {
        pending.contentHtml = contentRef.current.html;
        pending.contentText = contentRef.current.text;
        pending.content = contentRef.current.text;
      }
      if (Object.keys(pending).length === 0) return;

      if (
        !('title' in pending) &&
        !titleRef.current.trim() &&
        contentRef.current.text.trim()
      ) {
        pending.title = titleFromContent(contentRef.current.text);
        titleRef.current = pending.title;
      }

      const publish = options?.publish === true;
      const publishedRevision = localRevisionRef.current;
      saveChainRef.current = saveChainRef.current
        .then(async () => {
          await onUpdateNote(note.id, pending, { publish });
          if (localRevisionRef.current === publishedRevision) {
            if (publish) localDirtyRef.current = false;
            reportSavePending(false);
          }
        })
        .catch((error: unknown) => {
          notify({
            kind: 'error',
            message:
              error instanceof Error
                ? `${error.message} Your edits are still here.`
                : 'This note could not be saved. Your edits are still here.',
          });
        });
    },
    [note.id, notify, onUpdateNote, reportSavePending],
  );

  useEffect(() => {
    if (editing || !hasBeenEditingRef.current) return;
    // Empty notes are deleted by the discard timer instead of being published.
    if (discardWhenEmpty && !contentRef.current.text.trim()) return;
    if (!localDirtyRef.current && Object.keys(pendingRef.current).length === 0) return;
    // Publish the final editor content once, after the caret session is over.
    flush({ publish: true, includeLatestContent: true });
  }, [discardWhenEmpty, editing, flush]);

  const queueSave = useCallback(
    (patch: NotePatch) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        flush();
      }, Math.max(0, autosaveDelayMs));
    },
    [autosaveDelayMs, flush],
  );

  useEffect(() => {
    const handlePageHide = () => flush();
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
      // If the editor disappears because the user switched canvases, the final
      // content still has to be published to React state. A plain persist-only
      // save would leave the in-memory note stale when this canvas is reopened.
      if (localDirtyRef.current) {
        flush({ publish: true, includeLatestContent: true });
      } else {
        flush();
      }
    };
  }, [flush]);

  const handleContentChange = useCallback(
    (html: string, text: string) => {
      contentRef.current = { html, text };
      localDirtyRef.current = true;
      localRevisionRef.current += 1;
      reportSavePending(true);
      setEditorContent(html);
      if (text.trim()) clearDiscardTimer();
      queueSave({ contentHtml: html, contentText: text, content: text });
    },
    [clearDiscardTimer, queueSave, reportSavePending],
  );

  const handleEditorReady = useCallback(
    (next: Editor | null) => {
      editorRef.current = next;
      setEditor(next);
      onEditorReady(note.id, next);
    },
    [note.id, onEditorReady],
  );

  useEffect(() => {
    if (!insertion || !active || !editor || insertion.noteId !== note.id) return;
    const html = capturedTextToHtml(insertion.text);
    if (!html.trim()) {
      onInsertionApplied(insertion.nonce);
      return;
    }
    const timer = window.setTimeout(() => {
      if (insertAtEndRef.current) {
        editor.chain().focus('end', { scrollIntoView: false }).insertContent(html).run();
      } else {
        editor.chain().focus(undefined, { scrollIntoView: false }).insertContent(html).run();
      }
      onInsertionApplied(insertion.nonce);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [active, editor, insertion, note.id, onInsertionApplied]);

  const displayTitle = note.kind === 'image' ? 'Canvas image' : noteDisplayTitle(note);
  const showEditor = active && editing;
  const badge =
    editing || note.kind === 'image'
      ? null
      : note.browserCapture
        ? 'new'
        : note.hasUnseenUpdate
          ? 'updated'
          : null;

  return (
    <article
      className={classNames(
        'note-card',
        active && 'is-active',
        editing && 'is-editing',
        editing && 'nodrag',
        resizing && 'is-resizing',
        note.kind === 'image' && 'is-image',
      )}
      aria-label={displayTitle}
      style={
        {
          '--note-font-size': `${fontSize}px`,
          // Counter-scale inline badges so they stay readable at every canvas
          // zoom level instead of shrinking with the note.
          '--note-badge-scale': `${1 / Math.max(0.005, canvasZoom)}`,
        } as CSSProperties
      }
      onMouseDown={(event) => {
        if (!editing) return;
        const target = event.target;
        if (target instanceof Element && target.closest('.ProseMirror')) return;
        // Clicking the card's padding (or any part of the element outside the
        // editor) would move focus to the React Flow node wrapper and silently
        // end the caret session. Keep the caret where it was instead.
        event.preventDefault();
        editorRef.current?.commands.focus(undefined, { scrollIntoView: false });
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // React Flow's drag layer stops the native mouse event before React's
        // delegated handlers see it, so pointerdown is the reliable place to
        // clear a stale drag flag and activate the element on the first click.
        draggedRef.current = false;
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        if (!active) onActivate(note.id);
      }}
      onPointerMove={(event) => {
        const start = pointerStartRef.current;
        if (!start || event.buttons !== 1) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) return;
        draggedRef.current = true;
        clearClickTimer();
      }}
      onPointerUp={() => {
        pointerStartRef.current = null;
      }}
      onClick={(event) => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        if (editing) return;
        if (event.detail > 1) {
          clearClickTimer();
          return;
        }
        clearClickTimer();
        const anchor = { x: event.clientX, y: event.clientY };
        clickTimerRef.current = window.setTimeout(() => {
          clickTimerRef.current = null;
          editAnchorRef.current = anchor;
          onBeginEdit(note.id, { zoom: true, anchor });
        }, 240);
      }}
      onDoubleClick={(event) => {
        if (editing) return;
        event.preventDefault();
        event.stopPropagation();
        clearClickTimer();
        draggedRef.current = false;
        if (note.kind === 'image') {
          editAnchorRef.current = null;
          onBeginResize(note.id);
        } else {
          const anchor = { x: event.clientX, y: event.clientY };
          editAnchorRef.current = anchor;
          onBeginEdit(note.id, { anchor });
        }
      }}
    >
      {badge ? (
        <span
          className={classNames(
            'note-badge',
            badge === 'new' ? 'note-badge-new' : 'note-badge-updated',
          )}
          title={
            badge === 'new'
              ? 'New note saved from the browser'
              : 'This note has changed since you last opened it'
          }
        >
          <span className="note-badge-dot" aria-hidden="true" />
          {badge === 'new' ? 'New' : 'Updated'}
        </span>
      ) : null}
      <div
        className={classNames(
          'note-card-scroll',
          editing && 'nodrag',
        )}
      >
        {editorMounted ? (
          <div hidden={!showEditor}>
            <RichTextEditor
              noteId={note.id}
              projectId={note.projectId}
              contentHtml={editorContent}
              editable={showEditor}
              placeholder="Start writing… paste an image or insert selected page text."
              onChange={handleContentChange}
              onEditorReady={handleEditorReady}
              onBlur={handleEditorBlur}
              onFocus={clearDiscardTimer}
            />
          </div>
        ) : null}
        {!showEditor || !editorMounted ? <NoteHtmlPreview html={editorContent} /> : null}
      </div>
    </article>
  );
}

function NoteHtmlPreview({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    const images = [...root.querySelectorAll<HTMLImageElement>('img[data-attachment-id]')];
    for (const image of images) {
      const id = image.getAttribute('data-attachment-id');
      if (!id) continue;
      void getAttachmentUrl(id).then((url) => {
        if (!cancelled && url) image.src = url;
      });
    }
    return () => {
      cancelled = true;
    };
  }, [html]);

  const hasImage = html.includes('<img');
  const hasText = html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  if (!hasImage && !hasText) {
    return <p className="note-preview-empty">Click to write.</p>;
  }
  return (
    <div
      ref={ref}
      className="rich-text-content note-html-preview markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
