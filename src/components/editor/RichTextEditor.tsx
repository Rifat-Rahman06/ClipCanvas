import { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import type { EditorProps, EditorView } from '@tiptap/pm/view';
import { createAttachment } from '../../services/db/attachments';
import { compressImage } from '../../lib/images';
import { textFromHtml } from '../../lib/richText';
import { useToast } from '../../state/ToastContext';
import { AttachmentImage } from './AttachmentImage';

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

  // Tiptap compares these options on every render. Re-creating extension
  // instances or editor props forces it to replace the view props and call
  // updateState after every keystroke. Keeping them stable leaves ProseMirror
  // in charge of its DOM selection and focus, including after pressing Enter.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
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
      handlePaste: (view, event) =>
        imageTransferRef.current(view, event.clipboardData, view.state.selection.from),
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
    ({ editor: current }: { editor: Editor }) => {
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

  useEffect(() => {
    onEditorReady(editor ?? null);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) return;
    const handleBlur = () => onBlurRef.current?.();
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
    <EditorContent
      editor={editor}
      className="rich-text-editor"
      onMouseDown={() => {
        if (!editor.isFocused) {
          editor.commands.focus(undefined, { scrollIntoView: false });
        }
      }}
    />
  );
}
