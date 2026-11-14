import {
  Bold,
  BookOpen,
  Clipboard,
  ClipboardCopy,
  Download,
  Highlighter,
  List,
  SquarePen,
  Trash2,
} from 'lucide-react';
import type { Note, NoteContentSnapshot } from '../types';
import { noteDisplayTitle } from '../lib/utils';
import { htmlToMarkdown, markdownToHtml, textFromHtmlWithBreaks } from '../lib/richText';
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
  onToggleDisplayMode: (noteId: string) => void;
}

/** The canonical Markdown source for a note, derived from HTML when missing. */
function markdownFor(note: Note): string {
  if (note.content && note.content.trim()) return note.content;
  return note.contentHtml ? htmlToMarkdown(note.contentHtml) : '';
}

/** Selected-element actions live beside the note, never inside it. */
export function ActiveNoteToolbar({
  note,
  getLiveContent,
  onNoteAction,
  onInsertSelection,
  onFormat,
  onToggleDisplayMode,
}: ActiveNoteToolbarProps) {
  const { notify } = useToast();
  const displayMode = note.displayMode === 'preview' ? 'preview' : 'edit';
  const isMarkdownMode = displayMode === 'edit';

  /** Prefer the in-memory snapshot; the persisted note lags during editing. */
  const resolveContent = () => {
    const live = getLiveContent(note.id);
    if (live) {
      return {
        markdown: live.markdown,
        html: live.html.trim() ? live.html : markdownToHtml(live.markdown),
        text: live.text,
      };
    }
    const markdown = markdownFor(note);
    return {
      markdown,
      html: note.contentHtml?.trim() ? note.contentHtml : markdownToHtml(markdown),
      text: note.contentText ?? '',
    };
  };

  const copyElement = () => {
    const content = resolveContent();
    const markdown = content.markdown;
    const html = content.html;
    const text = markdown || textFromHtmlWithBreaks(html) || content.text || '';
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
            // The plain-text flavour is the Markdown source, so pasting into
            // another note, an editor, or a chat keeps the syntax. The HTML
            // flavour keeps the rendered look in word processors.
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
      .then(() => notify({ kind: 'success', message: 'Copied as Markdown.' }))
      .catch(() => notify({ kind: 'error', message: 'Could not copy this element.' }));
  };

  const downloadElement = () => {
    const content = resolveContent();
    const body = (
      content.markdown ||
      textFromHtmlWithBreaks(content.html) ||
      content.text ||
      ''
    ).trim();
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
      {!isMarkdownMode ? (
        <>
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
        </>
      ) : null}
      <IconButton
        label={isMarkdownMode ? 'Markdown edit mode' : 'Rendered preview mode'}
        size="sm"
        onClick={() => onToggleDisplayMode(note.id)}
      >
        {isMarkdownMode ? <SquarePen size={15} /> : <BookOpen size={15} />}
      </IconButton>
      <IconButton label="Copy as Markdown" size="sm" onClick={copyElement}>
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
