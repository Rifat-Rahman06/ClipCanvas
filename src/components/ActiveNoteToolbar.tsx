import {
  Bold,
  Clipboard,
  ClipboardCopy,
  Download,
  Highlighter,
  List,
  Trash2,
} from 'lucide-react';
import type { Note, NoteContentSnapshot } from '../types';
import { noteDisplayTitle } from '../lib/utils';
import { htmlToMarkdown } from '../lib/richText';
import { downloadTextFile } from '../services/import-export/download';
import { useToast } from '../state/ToastContext';
import { IconButton } from './Button';
import type { NoteCardAction } from './NoteCard';

export type NoteFormatAction = 'bold' | 'highlight' | 'bulletList';

interface ActiveNoteToolbarProps {
  note: Note;
  getLiveContent: (noteId: string) => NoteContentSnapshot | null;
  onNoteAction: (noteId: string, action: NoteCardAction) => void;
  onInsertSelection: () => void;
  onFormat: (noteId: string, action: NoteFormatAction) => void;
}

/** Selected-element actions live beside the note, never inside it. */
export function ActiveNoteToolbar({
  note,
  getLiveContent,
  onNoteAction,
  onInsertSelection,
  onFormat,
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
      <IconButton
        label="Bold"
        size="sm"
        onClick={() => onFormat(note.id, 'bold')}
      >
        <Bold size={15} />
      </IconButton>
      <IconButton
        label="Highlight"
        size="sm"
        onClick={() => onFormat(note.id, 'highlight')}
      >
        <Highlighter size={15} />
      </IconButton>
      <IconButton
        label="Bullet list"
        size="sm"
        onClick={() => onFormat(note.id, 'bulletList')}
      >
        <List size={15} />
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
    </div>
  );
}
