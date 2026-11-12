import { Bold, Clipboard, ClipboardCopy, List, Trash2 } from 'lucide-react';
import type { Note } from '../types';
import { markdownToHtml, textFromHtmlWithBreaks } from '../lib/richText';
import { useToast } from '../state/ToastContext';
import { IconButton } from './Button';
import type { NoteCardAction } from './NoteCard';

export type NoteFormatAction = 'bold' | 'bulletList';

interface ActiveNoteToolbarProps {
  note: Note;
  onNoteAction: (noteId: string, action: NoteCardAction) => void;
  onInsertSelection: () => void;
  onFormat: (noteId: string, action: NoteFormatAction) => void;
}

/** Selected-element actions live beside the note, never inside it. */
export function ActiveNoteToolbar({
  note,
  onNoteAction,
  onInsertSelection,
  onFormat,
}: ActiveNoteToolbarProps) {
  const { notify } = useToast();

  const copyElement = () => {
    const html = note.contentHtml?.trim()
      ? note.contentHtml
      : markdownToHtml(note.content);
    const text =
      textFromHtmlWithBreaks(html) ||
      note.contentText ||
      note.content;
    if (!text.trim()) {
      notify({ kind: 'info', message: 'This element has no text to copy.' });
      return;
    }

    const writePlainText = () => navigator.clipboard.writeText(text);
    const writeRichText = async () => {
      if (
        typeof ClipboardItem === 'undefined' ||
        typeof navigator.clipboard.write !== 'function'
      ) {
        await writePlainText();
        return;
      }
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
      } catch {
        // Some browsers expose the rich clipboard API but reject text/html.
        // Keep the copy action useful by falling back to plain text.
        await writePlainText();
      }
    };

    void writeRichText()
      .then(() => notify({ kind: 'success', message: 'Copied.' }))
      .catch(() => notify({ kind: 'error', message: 'Could not copy this element.' }));
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
        label="Bullet list"
        size="sm"
        onClick={() => onFormat(note.id, 'bulletList')}
      >
        <List size={15} />
      </IconButton>
      <IconButton label="Copy" size="sm" onClick={copyElement}>
        <Clipboard size={15} />
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
