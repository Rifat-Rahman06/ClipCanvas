import { type MouseEvent } from 'react';
import {
  Clipboard,
  ClipboardCopy,
  Download,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import type { Note, NoteContentSnapshot } from '../types';
import { noteDisplayTitle } from '../lib/utils';
import { htmlToMarkdown } from '../lib/richText';
import { downloadTextFile } from '../services/import-export/download';
import { useToast } from '../state/ToastContext';
import { IconButton } from './Button';
import type { NoteCardAction } from './NoteCard';

interface ActiveNoteToolbarProps {
  note: Note;
  getLiveContent: (noteId: string) => NoteContentSnapshot | null;
  onNoteAction: (noteId: string, action: NoteCardAction) => void;
  onInsertSelection: () => void;
  onZoomNote: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Selected-element actions live beside the note, or float at the top-right of
 * the canvas below the fit button when neither side of a near-full-width note
 * has room.
 */
export function ActiveNoteToolbar({
  note,
  getLiveContent,
  onNoteAction,
  onInsertSelection,
  onZoomNote,
}: ActiveNoteToolbarProps) {
  const { notify } = useToast();

  /** The note's canonical source, preferring the in-memory snapshot while editing. */
  const resolveSource = (): string => {
    const live = getLiveContent(note.id);
    if (live) return live.markdown;
    // The stored source is canonical; contentHtml is only a render cache and
    // must not be re-serialised for copying.
    if (note.content.trim()) return note.content;
    return note.contentHtml ? htmlToMarkdown(note.contentHtml) : '';
  };

  const copyElement = () => {
    const text = resolveSource();
    if (!text.trim()) {
      notify({ kind: 'info', message: 'This element has no text to copy.' });
      return;
    }
    // Plain text only: the stored Markdown/plain source, never rendered HTML.
    void navigator.clipboard
      .writeText(text)
      .then(() => notify({ kind: 'success', message: 'Copied as Markdown.' }))
      .catch(() => notify({ kind: 'error', message: 'Could not copy this element.' }));
  };

  const downloadElement = () => {
    const body = resolveSource().trim();
    const title = note.title.trim();
    const label = title || noteDisplayTitle(note);
    const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
    const text = title && body && firstLine !== title ? `${title}\n\n${body}` : body || label;
    const filename = `${label}.md`;

    void downloadTextFile(filename, `${text}\n`)
      .then(() => notify({ kind: 'success', message: `Downloaded “${filename}”.` }))
      .catch((error) => {
        // Dismissing the Save As dialog is not an error worth reporting.
        if (error instanceof Error && /cancel/i.test(error.message)) return;
        notify({ kind: 'error', message: 'This element could not be downloaded.' });
      });
  };

  return (
    <div
      className="active-note-toolbar"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <IconButton
        label="Insert selected text"
        size="sm"
        onClick={onInsertSelection}
      >
        <ClipboardCopy size={15} />
      </IconButton>
      <IconButton label="Copy note as Markdown" size="sm" onClick={copyElement}>
        <Clipboard size={15} />
      </IconButton>
      <IconButton label="Download as Markdown" size="sm" onClick={downloadElement}>
        <Download size={15} />
      </IconButton>
      <IconButton
        label="Delete note"
        variant="danger"
        size="sm"
        onClick={() => onNoteAction(note.id, 'delete')}
      >
        <Trash2 size={15} />
      </IconButton>
      <IconButton
        label="Zoom in to note"
        size="sm"
        onClick={onZoomNote}
      >
        <ZoomIn size={15} />
      </IconButton>
    </div>
  );
}
