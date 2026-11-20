import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  EditorContent,
  Extension,
  InputRule,
  Mark,
  mergeAttributes,
  useEditor,
  type Editor,
} from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Clipboard, Highlighter, List } from 'lucide-react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from '@tiptap/extension-table';
import type { EditorProps, EditorView } from '@tiptap/pm/view';
import type { Transaction } from '@tiptap/pm/state';
import { createAttachment } from '../../services/db/attachments';
import { compressImage } from '../../lib/images';
import {
  clipboardToNoteHtml,
  htmlToMarkdownForCopy,
  isStructuredClipboard,
  looksLikeBlockMarkdown,
  textFromHtml,
  textFromHtmlForCopy,
} from '../../lib/richText';
import { useToast } from '../../state/ToastContext';
import { AttachmentImage } from './AttachmentImage';
import { IconButton } from '../Button';

/**
 * Stores highlights as a plain `<mark>` element. The visible color comes from
 * the `--note-highlight` custom property, so changing the color in Settings
 * recolors every existing note without rewriting stored HTML.
 */
const HighlightMark = Mark.create({
  name: 'highlight',
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },
});

/**
 * Converts Markdown link syntax typed at the caret (`[label](https://…)`) into a
 * real link. Bold, italic, strike, inline code, headings, lists, quotes and code
 * fences already ship their own input rules.
 */
const MarkdownLinkInputRule = Extension.create({
  name: 'markdownLinkInputRule',
  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\[\]\n]+)\]\(([^()\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const [, label, href] = match;
          const link = state.schema.marks.link;
          if (!link || !label) return null;
          state.tr.replaceWith(
            range.from,
            range.to,
            state.schema.text(label, [link.create({ href })]),
          );
          return undefined;
        },
      }),
    ];
  },
});

interface RichTextEditorProps {
  noteId: string;
  projectId: string;
  contentHtml: string;
  editable: boolean;
  placeholder: string;
  onChange: (html: string, text: string) => void;
  onEditorReady: (editor: Editor | null) => void;
  onBlur?: () => void;
  onFocus?: () => void;
}

export function RichTextEditor({
  noteId,
  projectId,
  contentHtml,
  editable,
  placeholder,
  onChange,
  onEditorReady,
  onBlur,
  onFocus,
}: RichTextEditorProps) {
  const { notify } = useToast();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const noteRef = useRef({ noteId, projectId });
  noteRef.current = { noteId, projectId };
  const initialContentRef = useRef(contentHtml || '<p></p>');
  const lastEditorHtmlRef = useRef(contentHtml || '<p></p>');
  const imageTransferRef = useRef<
    (view: EditorView, data: DataTransfer | null, position: number) => boolean
  >(() => false);
  const structuredPasteRef = useRef<
    (view: EditorView, data: DataTransfer | null) => boolean
  >(() => false);
  const pointerReleaseRef = useRef<{
    x: number;
    y: number;
    from: number;
    to: number;
  } | null>(null);

  // Tiptap compares these options on every render. Re-creating extension
  // instances or editor props forces it to replace the view props and call
  // updateState after every keystroke. Keeping them stable leaves ProseMirror
  // in charge of its DOM selection and focus, including after pressing Enter.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Table.configure({
        resizable: false,
        HTMLAttributes: { class: 'note-table' },
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      HighlightMark,
      MarkdownLinkInputRule,
      AttachmentImage,
    ],
    [placeholder],
  );

  const editorProps = useMemo<EditorProps>(
    () => ({
      attributes: {
        class: 'rich-text-content markdown-body',
        spellcheck: 'true',
      },
      // The note grows with its content inside a transformed canvas. ProseMirror's
      // default scroll-to-selection walks up and changes the scrollTop of every
      // overflow-hidden ancestor, which shifts the whole canvas and makes the
      // caret land somewhere else. The NoteNode keeps the caret visible by
      // panning the canvas viewport instead of moving the edited node.
      handleScrollToSelection: () => true,
      // A collapsed caret keeps native behaviour (nothing to copy). With a
      // selection, write only readable plain text to text/plain, keeping
      // paragraph breaks without exposing any Markdown syntax.
      handleDOMEvents: {
        copy: (view, event) => {
          if (view.state.selection.empty) return false;
          const data = (event as ClipboardEvent).clipboardData;
          if (!data) return false;
          const { dom } = view.serializeForClipboard(view.state.selection.content());
          const plainText = textFromHtmlForCopy((dom as HTMLElement).innerHTML);
          if (!plainText.trim()) return false;
          event.preventDefault();
          data.clearData();
          data.setData('text/plain', plainText);
          return true;
        },
      },
      handlePaste: (view, event) =>
        imageTransferRef.current(view, event.clipboardData, view.state.selection.from) ||
        structuredPasteRef.current(view, event.clipboardData),
      handleDrop: (view, event) => {
        const position =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          view.state.selection.from;
        return imageTransferRef.current(view, event.dataTransfer, position);
      },
    }),
    [],
  );

  // Keep this callback stable. A fresh function on every render makes Tiptap
  // replace its options while a transaction is being handled, which is what
  // used to knock the caret out of the document after pressing Enter.
  const handleEditorUpdate = useCallback(
    ({ editor: current, transaction }: { editor: Editor; transaction: Transaction }) => {
      // Focusing the editor and moving the caret also emit `update`. Only a
      // document change is an edit; treating selection changes as edits replaced
      // the canonical Markdown with a lossy HTML round-trip.
      if (!transaction.docChanged) return;
      const html = current.getHTML();
      lastEditorHtmlRef.current = html;
      onChangeRef.current(html, textFromHtml(html));
    },
    [],
  );

  const editor = useEditor(
    {
      extensions,
      content: initialContentRef.current,
      editorProps,
      onUpdate: handleEditorUpdate,
    },
    [],
  );

  imageTransferRef.current = (view, data, position) => {
    if (!editor || !editableRef.current || !data) return false;
    const files = [...data.files].filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return false;
    void insertImages(view, files, position);
    return true;
  };

  structuredPasteRef.current = (view, data) => {
    if (!editor || !editableRef.current || !data) return false;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    // Only take over pastes that carry Markdown or block structure. A copied
    // word or phrase keeps the browser's native insertion.
    if (!isStructuredClipboard(html, text)) return false;
    const normalized = clipboardToNoteHtml({ html, text }).trim();
    if (!normalized) return false;
    // Inline-only Markdown (e.g. `**bold**` with no block markers) must land in
    // the current paragraph, not break it into a new one.
    const inline = /^<p>([\s\S]*)<\/p>$/.exec(normalized);
    const payload = inline && !looksLikeBlockMarkdown(text) ? inline[1] : normalized;
    const { from, to } = view.state.selection;
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .insertContentAt({ from, to }, payload)
      .run();
    return true;
  };

  useEffect(() => {
    onEditorReady(editor ?? null);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) return;
    const handleBlur = () => {
      pointerReleaseRef.current = null;
      onBlurRef.current?.();
    };
    const handleFocus = () => onFocusRef.current?.();
    editor.on('blur', handleBlur);
    editor.on('focus', handleFocus);
    return () => {
      editor.off('blur', handleBlur);
      editor.off('focus', handleFocus);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    // While the note is being edited, the TipTap document is the source of
    // truth. Autosave echoes and delayed IndexedDB reads must never replace
    // the document, because doing so resets ProseMirror's DOM selection and
    // leaves the next typed characters with nowhere to go.
    if (editable) return;
    const next = contentHtml || '<p></p>';
    if (next === lastEditorHtmlRef.current || next === editor.getHTML()) return;
    editor.commands.setContent(next, { emitUpdate: false });
    lastEditorHtmlRef.current = next;
  }, [editor, contentHtml, editable]);

  useEffect(() => {
    if (!editor) return;
    // Switching editability is not a content update. Emitting one here sends
    // an empty editor through autosave and can re-render it while focus is
    // moving into the document.
    editor.setEditable(editable, false);
  }, [editor, editable]);

  // Remember where a mouse selection was released. ProseMirror clamps the
  // caret to the nearest text position, so releasing in the note's blank area
  // would otherwise anchor the menu at the end of the line instead of at the
  // pointer.
  useEffect(() => {
    if (!editor) return;
    let selecting = false;

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      selecting = target instanceof Node && editor.view.dom.contains(target);
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (!selecting) return;
      selecting = false;
      pointerReleaseRef.current = null;
      if (!editor.isFocused) return;
      // Releasing over toolbar chrome should keep the caret anchor rather
      // than parking the menu on top of those buttons.
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.note-anchored-toolbar, .note-bubble-menu')
      ) {
        return;
      }
      // Let ProseMirror finish updating the selection for this gesture first.
      window.setTimeout(() => {
        if (editor.isDestroyed) return;
        const { selection } = editor.state;
        if (selection.empty) return;
        pointerReleaseRef.current = {
          x: event.clientX,
          y: event.clientY,
          from: selection.from,
          to: selection.to,
        };
        // Releasing in blank space usually leaves the selection unchanged, so
        // no transaction would move the already-visible menu. Nudge the plugin
        // (its default plugin key) to recompute the placement.
        editor.view.dispatch(
          editor.state.tr.setMeta('bubbleMenu', 'updatePosition'),
        );
      }, 0);
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, [editor]);

  // The selection menu is portaled to <body> with a fixed strategy so the
  // React Flow zoom transform can neither scale nor clip it. Both props keep a
  // stable identity: TipTap re-registers the plugin when they change.
  const bubbleMenuAppendTo = useCallback(() => document.body, []);
  const bubbleMenuOptions = useMemo(
    () => ({
      // `top-start` aligns the menu's left edge with the caret and lets it grow
      // to the right, instead of centering it over the caret.
      placement: 'top-start' as const,
      offset: 8,
      strategy: 'fixed' as const,
      flip: true,
      shift: true,
    }),
    [],
  );

  // Prefer the exact pointer release point for a mouse selection; fall back to
  // the moving end of the selection (the caret) for keyboard selections. A
  // zero-width rect keeps Floating UI placing the menu directly above that
  // point.
  const getBubbleMenuAnchor = useCallback(() => {
    if (!editor) return null;
    const { selection } = editor.state;
    if (selection.empty) return null;

    const release = pointerReleaseRef.current;
    if (release && release.from === selection.from && release.to === selection.to) {
      const rect = new DOMRect(release.x, release.y, 0, 1);
      return {
        getBoundingClientRect: () => rect,
        getClientRects: () => [rect],
      };
    }

    try {
      const coords = editor.view.coordsAtPos(selection.head);
      const height = Math.max(1, coords.bottom - coords.top);
      const rect = new DOMRect(coords.left, coords.top, 0, height);
      return {
        getBoundingClientRect: () => rect,
        getClientRects: () => [rect],
      };
    } catch {
      // A position inside an unrendered block has no coordinates; fall back to
      // TipTap's default selection anchoring.
      return null;
    }
  }, [editor]);

  const runSelectionFormat = useCallback(
    (action: 'bold' | 'highlight' | 'bulletList') => {
      if (!editor) return;
      const chain = editor.chain().focus(undefined, { scrollIntoView: false });
      if (action === 'bold') chain.toggleBold().run();
      else if (action === 'highlight') chain.toggleMark('highlight').run();
      else chain.toggleBulletList().run();
    },
    [editor],
  );

  // Copies just the selected range as Markdown, mirroring Ctrl+C inside the
  // editor and the whole-note copy in the note toolbar.
  const copySelectionAsMarkdown = useCallback(() => {
    if (!editor) return;
    const { selection } = editor.state;
    if (selection.empty) return;
    try {
      const { dom } = editor.view.serializeForClipboard(selection.content());
      const markdown = htmlToMarkdownForCopy((dom as HTMLElement).innerHTML);
      if (!markdown.trim()) {
        notify({ kind: 'info', message: 'The selection has no text to copy.' });
        return;
      }
      void navigator.clipboard
        .writeText(markdown)
        .then(() => notify({ kind: 'success', message: 'Selection copied as Markdown.' }))
        .catch(() => notify({ kind: 'error', message: 'Could not copy the selection.' }));
    } catch {
      notify({ kind: 'error', message: 'Could not copy the selection.' });
    }
  }, [editor, notify]);

  async function insertImages(
    view: EditorView,
    files: File[],
    position: number,
  ): Promise<void> {
    const nodes: Array<{
      type: string;
      attrs: { attachmentId: string; alt: string; width: number };
    }> = [];
    for (const file of files) {
      try {
        const compressed = await compressImage(file);
        const attachment = await createAttachment({
          noteId: noteRef.current.noteId,
          projectId: noteRef.current.projectId,
          blob: compressed.blob,
          width: compressed.width,
          height: compressed.height,
          mimeType: compressed.mimeType,
        });
        nodes.push({
          type: 'attachmentImage',
          attrs: {
            attachmentId: attachment.id,
            alt: file.name || 'Pasted image',
            width: Math.min(540, compressed.width),
          },
        });
      } catch (error) {
        notify({
          kind: 'error',
          message: error instanceof Error ? error.message : 'That image could not be added.',
        });
      }
    }
    if (nodes.length === 0) return;
    const safePosition = Math.min(Math.max(1, position), view.state.doc.content.size);
    editor
      ?.chain()
      .focus(undefined, { scrollIntoView: false })
      .insertContentAt(safePosition, nodes)
      .run();
  }

  if (!editor) return <div className="rich-text-loading" />;

  return (
    <>
      <EditorContent
        editor={editor}
        className="rich-text-editor"
        onMouseDown={() => {
          if (!editor.isFocused) {
            editor.commands.focus(undefined, { scrollIntoView: false });
          }
        }}
      />
      <BubbleMenu
        editor={editor}
        appendTo={bubbleMenuAppendTo}
        getReferencedVirtualElement={getBubbleMenuAnchor}
        options={bubbleMenuOptions}
        className="note-bubble-menu"
        role="toolbar"
        aria-label="Text formatting"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <IconButton label="Bold" size="sm" onClick={() => runSelectionFormat('bold')}>
          <Bold size={15} />
        </IconButton>
        <IconButton
          label="Highlight"
          size="sm"
          onClick={() => runSelectionFormat('highlight')}
        >
          <Highlighter size={15} />
        </IconButton>
        <IconButton
          label="Bullet list"
          size="sm"
          onClick={() => runSelectionFormat('bulletList')}
        >
          <List size={15} />
        </IconButton>
        <IconButton
          label="Copy selection as Markdown"
          size="sm"
          onClick={copySelectionAsMarkdown}
        >
          <Clipboard size={15} />
        </IconButton>
      </BubbleMenu>
    </>
  );
}
