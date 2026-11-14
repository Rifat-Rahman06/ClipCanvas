import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/react';
import { getAttachmentUrl } from '../services/db/attachments';
import type { Note, NoteContentSnapshot, NoteDisplayMode, NoteInsertion, NotePatch, UpdateNoteOptions } from '../types';
import { classNames, noteDisplayTitle, textFromMarkdown, titleFromContent } from '../lib/utils';
import { htmlToMarkdown, markdownToHtml, textFromHtml } from '../lib/richText';
import { capturedTextToHtml } from '../lib/insertion';
import { useToast } from '../state/ToastContext';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { RichTextEditor } from './editor/RichTextEditor';

/** The canonical Markdown source for a note, derived from HTML when missing. */
function noteMarkdown(note: Note): string {
  if (note.content && note.content.trim()) return note.content;
  return note.contentHtml ? htmlToMarkdown(note.contentHtml) : '';
}

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
  /** Registers the latest in-memory content so copy/download never read stale data. */
  onRegisterLiveContent: (
    noteId: string,
    getter: (() => NoteContentSnapshot) | null,
  ) => void;
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
  onRegisterLiveContent,
  onCaretActivity,
}: NoteCardProps) {
  const { notify } = useToast();
  const onCaretActivityRef = useRef(onCaretActivity);
  onCaretActivityRef.current = onCaretActivity;
  const editorRef = useRef<Editor | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const displayMode: NoteDisplayMode = note.displayMode === 'preview' ? 'preview' : 'edit';
  // Images never have Markdown source; every other note can be edited either as
  // Markdown (edit mode) or as rich content (preview mode).
  const isMarkdownMode = displayMode === 'edit' && note.kind !== 'image';
  const initialHtml = note.contentHtml ?? markdownToHtml(note.content);
  const initialMarkdown = noteMarkdown(note);
  const [editorContent, setEditorContent] = useState(initialHtml);
  const [markdownContent, setMarkdownContent] = useState(initialMarkdown);
  const contentRef = useRef({
    html: initialHtml,
    text: note.contentText ?? note.content,
    markdown: initialMarkdown,
  });
  // Which surface produced the newest edit. Saves then send only that source
  // and let the repository derive the other representation, so Markdown is
  // never overwritten by plain text (or vice versa) mid-session.
  const lastEditSourceRef = useRef<'markdown' | 'rich'>('markdown');
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;
  const previousModeRef = useRef(displayMode);
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

  // Copy and download run from the toolbar, which only sees the persisted note.
  // Autosave deliberately does not publish during an edit session, so expose the
  // live values instead of letting those actions copy stale content.
  useEffect(() => {
    const getter = (): NoteContentSnapshot => {
      if (lastEditSourceRef.current === 'rich') {
        return {
          markdown: htmlToMarkdown(contentRef.current.html),
          html: contentRef.current.html,
          text: contentRef.current.text,
        };
      }
      const markdown = contentRef.current.markdown;
      return {
        markdown,
        // Derive fresh HTML instead of trusting the debounced cache, so a copy
        // immediately after typing still carries the newest rendering.
        html: markdownToHtml(markdown),
        text: textFromMarkdown(markdown),
      };
    };
    onRegisterLiveContent(note.id, getter);
    return () => onRegisterLiveContent(note.id, null);
  }, [note.id, onRegisterLiveContent]);

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
      if (displayModeRef.current !== 'preview') return;
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
    if (editing && !isMarkdownMode) setEditorMounted(true);
  }, [editing, isMarkdownMode]);

  useEffect(() => {
    if (!editing || !editor || isMarkdownMode) return;
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
  }, [editing, editor, isMarkdownMode]);

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
      if (isMarkdownMode) {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      } else {
        editor?.commands.blur();
      }
      onBeginResize(note.id);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editing, editor, isMarkdownMode, note.id, onBeginResize]);

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
    // While editing, the active surface is the source of truth. Syncing the
    // saved note back into it can race with autosave and replace a freshly
    // inserted line, dropping focus and making the editor stop accepting input.
    // Persist-only autosaves also leave `note` behind the editor until the edit
    // session ends, so never let that stale snapshot overwrite newer local text.
    if (editing || localDirtyRef.current) return;
    if ('contentHtml' in pendingRef.current || 'content' in pendingRef.current) return;
    const html = note.contentHtml ?? markdownToHtml(note.content);
    const text = note.contentText ?? note.content;
    const markdown = noteMarkdown(note);
    if (
      html === contentRef.current.html &&
      text === contentRef.current.text &&
      markdown === contentRef.current.markdown
    ) {
      return;
    }
    contentRef.current = { html, text, markdown };
    setEditorContent(html);
    setMarkdownContent(markdown);
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
        if (lastEditSourceRef.current === 'markdown') {
          contentRef.current.text = textFromMarkdown(contentRef.current.markdown);
          // Only the Markdown source is sent; the repository renders the HTML.
          delete pending.contentHtml;
          delete pending.contentText;
          pending.content = contentRef.current.markdown;
        } else {
          // Only the rich HTML is sent; the repository derives the Markdown.
          delete pending.content;
          pending.contentHtml = contentRef.current.html;
          pending.contentText = contentRef.current.text;
        }
      }
      if (Object.keys(pending).length === 0) return;

      if (
        !('title' in pending) &&
        !titleRef.current.trim() &&
        contentRef.current.text.trim()
      ) {
        const titleSource =
          lastEditSourceRef.current === 'markdown'
            ? textFromMarkdown(contentRef.current.markdown)
            : contentRef.current.text;
        pending.title = titleFromContent(titleSource);
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
      contentRef.current = { ...contentRef.current, html, text };
      lastEditSourceRef.current = 'rich';
      localDirtyRef.current = true;
      localRevisionRef.current += 1;
      reportSavePending(true);
      setEditorContent(html);
      if (text.trim()) clearDiscardTimer();
      // The repository converts this HTML back into Markdown on save.
      queueSave({ contentHtml: html, contentText: text });
    },
    [clearDiscardTimer, queueSave, reportSavePending],
  );

  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      contentRef.current = {
        ...contentRef.current,
        markdown,
        // Cheap non-empty marker for the discard check; the accurate plain text
        // is computed once, when the edit is flushed.
        text: markdown.trim(),
      };
      lastEditSourceRef.current = 'markdown';
      localDirtyRef.current = true;
      localRevisionRef.current += 1;
      reportSavePending(true);
      setMarkdownContent(markdown);
      if (markdown.trim()) clearDiscardTimer();
      // The repository renders this Markdown into HTML on save.
      queueSave({ content: markdown });
    },
    [clearDiscardTimer, queueSave, reportSavePending],
  );

  // Switching modes mid-session must hand the other surface the current
  // content, otherwise a Markdown edit would not be visible in the rich editor
  // (or vice versa) until the note is reopened.
  useEffect(() => {
    if (previousModeRef.current === displayMode) return;
    previousModeRef.current = displayMode;
    if (displayMode === 'edit') {
      const markdown =
        lastEditSourceRef.current === 'markdown'
          ? contentRef.current.markdown
          : htmlToMarkdown(contentRef.current.html);
      contentRef.current.markdown = markdown;
      setMarkdownContent(markdown);
      return;
    }
    const html =
      lastEditSourceRef.current === 'markdown'
        ? markdownToHtml(contentRef.current.markdown)
        : contentRef.current.html;
    contentRef.current.html = html;
    contentRef.current.text = textFromHtml(html);
    setEditorContent(html);
    editorRef.current?.commands.setContent(html, { emitUpdate: false });
  }, [displayMode]);

  // Keep the rendered HTML close behind the Markdown while it is being typed,
  // so switching to preview (or leaving the note) never shows stale content.
  useEffect(() => {
    if (!editing || !isMarkdownMode) return;
    const timer = window.setTimeout(() => {
      const html = markdownToHtml(markdownContent);
      contentRef.current.html = html;
      contentRef.current.text = textFromHtml(html);
      setEditorContent(html);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [editing, isMarkdownMode, markdownContent]);

  const handleEditorReady = useCallback(
    (next: Editor | null) => {
      editorRef.current = next;
      setEditor(next);
      onEditorReady(note.id, next);
    },
    [note.id, onEditorReady],
  );

  useEffect(() => {
    if (!insertion || !active || insertion.noteId !== note.id) return;
    if (isMarkdownMode) {
      const addition = insertion.text.trim();
      if (!addition) {
        onInsertionApplied(insertion.nonce);
        return;
      }
      const current = contentRef.current.markdown.trimEnd();
      handleMarkdownChange(current ? `${current}\n\n${addition}` : addition);
      onInsertionApplied(insertion.nonce);
      return;
    }
    if (!editor) return;
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
  }, [
    active,
    editor,
    handleMarkdownChange,
    insertion,
    isMarkdownMode,
    note.id,
    onInsertionApplied,
  ]);

  const displayTitle = note.kind === 'image' ? 'Canvas image' : noteDisplayTitle(note);
  const showEditor = active && editing && !isMarkdownMode;
  const showMarkdown = active && editing && isMarkdownMode;
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
        // The Markdown textarea handles its own pointer interactions.
        if (isMarkdownMode) return;
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
        {showMarkdown ? (
          <MarkdownEditor
            value={markdownContent}
            placeholder="Write Markdown here…"
            onChange={handleMarkdownChange}
            onFocus={clearDiscardTimer}
            onBlur={handleEditorBlur}
          />
        ) : null}
        {(!showEditor || !editorMounted) && !showMarkdown ? (
          <NoteHtmlPreview html={editorContent} mode={displayMode} />
        ) : null}
      </div>
    </article>
  );
}

function NoteHtmlPreview({ html, mode }: { html: string; mode: NoteDisplayMode }) {
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
      className={classNames(
        'rich-text-content',
        'note-html-preview',
        'markdown-body',
        `note-display-${mode}`,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
