import { type MouseEvent } from 'react';
import {
  Clipboard,
  ClipboardCopy,
  Download,
  FileCode,
  FileText,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import type { Note, NoteContentSnapshot } from '../types';
import { noteDisplayTitle } from '../lib/utils';
import {
  htmlToMarkdown,
  markdownToHtml,
  textFromHtmlForCopy,
  type TextFromHtmlOptions,
} from '../lib/richText';
import { blobToPng } from '../lib/images';
import { getAttachmentBlob } from '../services/db/attachments';
import { downloadTextFile } from '../services/import-export/download';
import { useToast } from '../state/ToastContext';
import { ActionMenu } from './ActionMenu';
import { IconButton } from './Button';
import type { NoteCardAction } from './NoteCard';

/**
 * TXT downloads ask the shared converter to keep the structure a text file can
 * still express: task state, image descriptions on their own line, table
 * columns and quotation depth. Clipboard copies use the default options.
 */
const TXT_OPTIONS: TextFromHtmlOptions = {
  taskStatus: true,
  imageBlocks: true,
  tableColumns: true,
  quoteDepth: true,
};

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

  /**
   * The note as plain text, reusing the clipboard text conversion. The live
   * editor HTML is the most faithful source while editing; stored notes fall
   * back to their rendered HTML and then to the Markdown source.
   */
  const resolvePlainText = (): string => {
    const live = getLiveContent(note.id);
    if (live?.html.trim()) return textFromHtmlForCopy(live.html, TXT_OPTIONS);
    if (!live && note.contentHtml?.trim()) {
      return textFromHtmlForCopy(note.contentHtml, TXT_OPTIONS);
    }
    const source = resolveSource();
    return source.trim()
      ? textFromHtmlForCopy(markdownToHtml(source), TXT_OPTIONS)
      : (note.contentText ?? '');
  };

  /** The attachment id of an image note, read from its HTML or Markdown source. */
  const resolveImageAttachmentId = (): string => {
    const htmlId = /data-attachment-id="([^"]+)"/.exec(note.contentHtml ?? '')?.[1];
    if (htmlId) return htmlId;
    return /attachment:\/\/([^\s)"']+)/.exec(note.content)?.[1] ?? '';
  };

  /**
   * Image notes copy their stored bytes to the system clipboard, so the image
   * can be pasted into other apps or back onto a canvas. Text notes keep the
   * Markdown copy path in `copyElement` below.
   */
  const copyImageElement = async () => {
    const attachmentId = resolveImageAttachmentId();
    if (!attachmentId) {
      notify({ kind: 'error', message: 'This image is no longer available.' });
      return;
    }
    try {
      const blob = await getAttachmentBlob(attachmentId);
      if (!blob) {
        notify({ kind: 'error', message: 'This image is no longer available.' });
        return;
      }
      // Passing a promise keeps the clipboard write inside the click's user
      // activation while the stored WebP/JPEG is converted to the PNG format
      // Chrome's async clipboard accepts.
      const png = blob.type === 'image/png' ? Promise.resolve(blob) : blobToPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      notify({ kind: 'success', message: 'Image copied.' });
    } catch {
      notify({ kind: 'error', message: 'Could not copy this image.' });
    }
  };

  const copyElement = () => {
    if (note.kind === 'image') {
      void copyImageElement();
      return;
    }
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

  const downloadElement = (format: 'markdown' | 'text') => {
    const body = (format === 'text' ? resolvePlainText() : resolveSource()).trim();
    const title = note.title.trim();
    const label = title || noteDisplayTitle(note);
    const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
    const text = title && body && firstLine !== title ? `${title}\n\n${body}` : body || label;
    const filename = `${label}.${format === 'text' ? 'txt' : 'md'}`;

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
        label={note.kind === 'image' ? 'Copy image' : 'Copy note as Markdown'}
        size="sm"
        onClick={copyElement}
      >
        <Clipboard size={15} />
      </IconButton>
      <ActionMenu
        label="Download note"
        size="sm"
        trigger={<Download size={15} />}
        items={[
          {
            label: 'Markdown (.md)',
            icon: FileCode,
            onSelect: () => downloadElement('markdown'),
          },
          {
            label: 'Plain text (.txt)',
            icon: FileText,
            onSelect: () => downloadElement('text'),
          },
        ]}
      />
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
