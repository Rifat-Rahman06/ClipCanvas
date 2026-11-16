# ClipCanvas — WYSIWYG Markdown Editing (implementation plan)

**Repo:** `C:\Users\rifat\Videos\ClipCanvas\ClipCanvas`
**Platform:** Windows. Use `npm.cmd`, never `npm`.
**Scope:** Replace the Markdown-textarea / Preview split with a single always-rendered WYSIWYG editor, keep Markdown as the canonical source, and make Ctrl+C copy Markdown.

Read this file top to bottom. Every path is relative to the repo root. Only touch the files listed here.
Do **not** commit anything. The working tree already contains unrelated uncommitted work (canvas import/export/rename); leave it alone.

> **READ THIS FIRST — Revision 2 is at the bottom of this file (search `## Revision 2`).**
> Revision 2 supersedes §1's do-not-touch list, the `displayMode` note in §0, the
> "Behaviour notes" section, and the merged conversation dump that follows it.
> Wherever they disagree, Revision 2 wins.

---

## 0. Locked decisions (do not deviate)

| Area | Decision |
|---|---|
| Source of truth | `Note.content` stays canonical Markdown/plain text. `contentHtml` is a render cache. |
| Editing surface | TipTap only. No source textarea, no Editor/Preview toggle, no source viewer anywhere. |
| Idle notes | Always rendered from `contentHtml`, exactly as today. |
| Typing | Markdown converts as you type (input rules). |
| Ctrl+C with a selection | Copy only the selection as Markdown, `text/plain` only. |
| Ctrl+C with no selection | Do nothing (native). |
| Toolbar Copy button | Copies the whole note's stored source (Markdown or plain text), `text/plain` only. |
| Plain notes | A document made only of paragraphs/line breaks serializes back to plain text, not Markdown. |
| Images | Keep `![alt](attachment://id)` when copying. |
| `displayMode` | Keep the field in stored records, backups, canvas-transfer files and types, but stop reading/writing it in the UI. No DB version bump. |
| Tests | Do not run `npm test`. Use `npm.cmd run typecheck` and `npm.cmd run build`. |

## 1. Files to change

| File | Action |
|---|---|
| `package.json` | Add `@tiptap/extension-list` (task lists) |
| `src/lib/richText.ts` | Add storage/clipboard serializers, task-list support, inline-Markdown paste |
| `src/services/db/repository.ts` | Derive `content` with `serializeNoteSource` |
| `src/components/editor/RichTextEditor.tsx` | H1–H6, task lists, link input rule, Ctrl+C interception |
| `src/components/NoteCard.tsx` | Remove Markdown mode entirely; WYSIWYG-only |
| `src/components/ActiveNoteToolbar.tsx` | Remove mode toggle; plain-text-only copy |
| `src/components/CanvasView.tsx` | Remove `toggleDisplayMode` plumbing |
| `src/components/editor/MarkdownEditor.tsx` | **Delete** |
| `src/styles/canvas.css` | Delete `.note-markdown-input` rules |
| `src/styles/editor.css` | Add H5/H6 + task-list styles |
| `README.md` | Rewrite the **Writing** section |

Do **not** touch: `src/services/db/database.ts`, `src/services/import-export/backup.ts`,
`src/services/import-export/canvasTransfer.ts`, `src/types/index.ts`,
`src/popup/PopupApp.tsx`, `src/App.tsx`, `tests/*`.

---

## Step 1 — Dependency

`@tiptap/extension-list@3.32.2` is already installed as a transitive dependency of
`@tiptap/starter-kit`, and it exports `TaskList` / `TaskItem`. Declare it directly:

1. In `package.json` → `dependencies`, keep alphabetical order and add:

```json
"@tiptap/extension-list": "^3.32.2",
```

2. Run:

```
npm.cmd install
```

If the install cannot reach the network, skip it — the package already exists in
`node_modules/@tiptap/extension-list` and resolution will still work.

---

## Step 2 — `src/lib/richText.ts`

### 2.1 Allow task-list markup through the sanitizer

Replace the `NOTE_TAGS` array and `NOTE_ATTRIBUTES` object (currently lines 6–48) with:

```ts
const NOTE_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'code',
  'pre',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'hr',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'mark',
  'span',
  // Task lists (GFM checkboxes and the editor's task-item node).
  'label',
  'input',
  'div',
] as const;

const NOTE_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'data-attachment-id'],
  ol: ['start'],
  code: ['class'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
  ul: ['data-type'],
  li: ['data-type', 'data-checked'],
  input: ['type', 'checked'],
};
```

### 2.2 Normalize GFM task lists into the editor's shape

`marked` renders a task item as `<li><input type="checkbox" disabled> text</li>`.
TipTap only recognizes `li[data-type="taskItem"]` inside `ul[data-type="taskList"]`,
so without normalization a task list silently degrades to a plain bullet list the
first time the note is opened in the editor.

Add this helper immediately after `restoreAttachmentImages` (currently ends at line 169):

```ts
/**
 * Rewrites GFM task-list markup (`<li><input type="checkbox"> text</li>`) into the
 * shape the TipTap task-item node parses (`li[data-type="taskItem"]` with a label,
 * checkbox, and div), so the same HTML works for the preview and the editor.
 */
function normalizeTaskLists(html: string): string {
  if (typeof document === 'undefined' || !/type=["']?checkbox/i.test(html)) return html;
  const template = document.createElement('template');
  template.innerHTML = html;

  const findCheckbox = (element: Element): HTMLInputElement | null => {
    for (const child of Array.from(element.children)) {
      if (child instanceof HTMLInputElement && child.type === 'checkbox') return child;
    }
    const paragraph = element.firstElementChild;
    if (paragraph instanceof HTMLParagraphElement) {
      const nested = paragraph.querySelector(':scope > input[type="checkbox"]');
      if (nested instanceof HTMLInputElement) return nested;
    }
    return null;
  };

  for (const item of Array.from(template.content.querySelectorAll('li'))) {
    const checkbox = findCheckbox(item);
    if (!checkbox) continue;
    const list = item.parentElement;
    if (!list) continue;
    const checked = checkbox.checked;
    checkbox.remove();

    const content = document.createElement('div');
    while (item.firstChild) content.appendChild(item.firstChild);

    const label = document.createElement('label');
    const mirror = document.createElement('input');
    mirror.type = 'checkbox';
    mirror.checked = checked;
    if (checked) mirror.setAttribute('checked', '');
    label.append(mirror, document.createElement('span'));

    item.replaceChildren(label, content);
    item.setAttribute('data-type', 'taskItem');
    item.setAttribute('data-checked', checked ? 'true' : 'false');
    if (list instanceof HTMLUListElement) list.setAttribute('data-type', 'taskList');
  }

  return template.innerHTML;
}
```

Then change `markdownToHtml` (line 172) so the rendered HTML is normalized **before**
sanitizing:

```ts
    const rendered = marked.parse(restoreAttachmentImages(markdown), {
      async: false,
      gfm: true,
      breaks: true,
    }) as string;
    return sanitizeNoteHtml(normalizeTaskLists(rendered));
```

### 2.3 Inline Markdown on the clipboard

Change the first branch of `clipboardToNote` (line 261) so inline-only Markdown is
converted when no rich HTML flavour exists, while rich HTML still wins over a
stray inline marker:

```ts
  if (plain && (looksLikeBlockMarkdown(plain) || (!rich && looksLikeMarkdown(plain)))) {
    return { markdown: plain, html: markdownToHtml(plain) };
  }
```

### 2.4 Two Turndown serializers

Currently `getTurndown()` (line 412) builds one cached service that escapes literal
Markdown characters. Storage must escape (so typed `*` stays literal); clipboard
copy must not (so prose stays prose).

Refactor the block from `let turndownService: TurndownService | null = null;`
(line 410) through the end of `getTurndown()` (line 519) into:

```ts
let storageTurndown: TurndownService | null = null;
let copyTurndown: TurndownService | null = null;

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    // Turndown appends the newline itself. Including one here produced a blank
    // line after every <br>.
    br: '  ',
  });
  service.use(gfm);

  // ... keep every existing addRule call exactly as it is today
  // (clipcanvasTableCell, clipcanvasCodeBlock, clipcanvasListItemParagraph,
  // clipcanvasStrikethrough, clipcanvasHighlight, clipcanvasUnderline,
  // clipcanvasAttachment) ...

  // The editor renders task items as
  // `<li data-type="taskItem" data-checked="true"><label>…</label><div>…</div></li>`.
  // GFM's rule only matches a checkbox that is a direct child of `<li>`, so it
  // never fires here. Emit the full list marker ourselves; this rule replaces the
  // default list-item rule for these nodes, so the bullet is not duplicated.
  service.addRule('clipcanvasTaskItem', {
    filter: (node) =>
      node.nodeName === 'LI' &&
      (node as HTMLElement).getAttribute('data-type') === 'taskItem',
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
      const text = content.replace(/\s*\n+\s*/g, ' ').trim();
      return `\n${checked ? '- [x]' : '- [ ]'} ${text}\n`;
    },
  });

  return service;
}

function getStorageTurndown(): TurndownService {
  if (!storageTurndown) storageTurndown = createTurndown();
  return storageTurndown;
}

function getCopyTurndown(): TurndownService {
  if (!copyTurndown) {
    const service = createTurndown();
    // Copying prose must not add backslashes the user never typed. Storage keeps
    // the default escaping so literal markers stay literal on reopen.
    service.escape = (text: string) => text;
    copyTurndown = service;
  }
  return copyTurndown;
}
```

Update `htmlToMarkdown` (line 575) to use the storage serializer:

```ts
    value = getStorageTurndown().turndown(stripTableLayoutMarkup(html));
```

### 2.5 New exported serializers

Append after `htmlToMarkdown`:

```ts
/**
 * Clipboard serializer: Markdown without escaping ordinary text. Used for
 * Ctrl+C selections inside the editor, where prose must stay prose.
 */
export function htmlToMarkdownForCopy(html: string): string {
  if (!html.trim()) return '';
  let value: string;
  try {
    value = getCopyTurndown().turndown(stripTableLayoutMarkup(html));
  } catch {
    value = decodeBasicEntities(html.replace(/<[^>]+>/g, ' '));
  }
  return tidyMarkdown(value);
}

/**
 * True when the HTML is only paragraphs and line breaks, which means the source
 * can be stored as plain text instead of Markdown.
 */
function isPlainTextDocument(html: string): boolean {
  return !/<(?!\/?(?:p|br)\b)[a-z][^>]*>/i.test(html);
}

function plainTextFromParagraphs(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '');
  const plain = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return decodeBasicEntities(plain)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The canonical source for a stored note, derived from editor HTML.
 *
 * A document containing only paragraphs and line breaks is written back as plain
 * text, so a plain note never acquires Markdown markers merely because it was
 * edited. Anything with structure or marks becomes Markdown with escaping.
 */
export function serializeNoteSource(html: string): string {
  if (!html.trim()) return '';
  if (isPlainTextDocument(html)) return plainTextFromParagraphs(html);
  return htmlToMarkdown(html);
}
```

---

## Step 3 — `src/services/db/repository.ts`

The repository is the only place that turns editor HTML back into the canonical
source. Switch it to the new serializer.

1. Line 21, replace the import:

```ts
import { markdownToHtml, sanitizeNoteHtml, serializeNoteSource, textFromHtml } from '../../lib/richText';
```

2. Replace the block at lines 651–655:

```ts
  if (patch.contentHtml !== undefined && patch.content === undefined) {
    // Rich edits are converted back into the canonical source. A document made
    // only of paragraphs is stored as plain text instead of Markdown.
    content = cleanContent(serializeNoteSource(contentHtml));
  }
```

`htmlToMarkdown` must no longer be imported here (`noUnusedLocals`).

`computeContent`, `buildNote`, `cleanStoredNote`, the `displayMode` fields and the
rest of this file stay untouched.

---

## Step 4 — `src/components/editor/RichTextEditor.tsx`

### 3.1 Imports

Replace the first three import lines with:

```ts
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
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskItem, TaskList } from '@tiptap/extension-list';
```

and extend the `richText` import (currently lines 15–19):

```ts
import {
  clipboardToNoteHtml,
  htmlToMarkdownForCopy,
  isStructuredClipboard,
  looksLikeBlockMarkdown,
  textFromHtml,
} from '../../lib/richText';
```

### 3.2 Link input rule

Add after `HighlightMark` (after line 36):

```ts
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
          state.tr
            .replaceWith(range.from, range.to, state.schema.text(label, [link.create({ href })]));
          return undefined;
        },
      }),
    ];
  },
});
```

### 3.3 Extension list

Replace the `extensions` memo body (lines 85–102) with:

```ts
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
```

### 3.4 Ctrl+C handler

Inside `editorProps` (lines 104–127), add a `handleDOMEvents` entry after `handleScrollToSelection`:

```ts
      // A collapsed caret keeps native behaviour (nothing to copy). With a
      // selection, write only Markdown to text/plain so copied content keeps its
      // syntax and never turns into rich HTML.
      handleDOMEvents: {
        copy: (view, event) => {
          if (view.state.selection.empty) return false;
          const data = event.clipboardData;
          if (!data) return false;
          const { dom } = view.serializeForClipboard(view.state.selection.content());
          const markdown = htmlToMarkdownForCopy((dom as HTMLElement).innerHTML);
          if (!markdown.trim()) return false;
          event.preventDefault();
          data.clearData();
          data.setData('text/plain', markdown);
          return true;
        },
      },
```

### 3.5 Inline paste handling

Replace the body of `structuredPasteRef.current` (lines 163–180) so a single-paragraph
result is inserted inline instead of splitting the current paragraph:

```ts
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
```

---

## Step 4 — `src/components/NoteCard.tsx`

This file is the bulk of the change. Work through it in order.

### 4.1 Imports

Replace lines 1–10 with:

```ts
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/react';
import { getAttachmentUrl } from '../services/db/attachments';
import type { Note, NoteContentSnapshot, NoteInsertion, NotePatch, UpdateNoteOptions } from '../types';
import { classNames, noteDisplayTitle, titleFromContent } from '../lib/utils';
import { markdownToHtml, serializeNoteSource, textFromHtml } from '../lib/richText';
import { capturedTextToHtml } from '../lib/insertion';
import { useToast } from '../state/ToastContext';
import { RichTextEditor } from './editor/RichTextEditor';
```

Delete the `noteMarkdown()` helper (lines 12–16) — it has no callers after the rewrite.

### 4.2 State and refs

Replace lines 92–111 (from `const displayMode…` through `const previousModeRef…`) with:

```ts
  const initialHtml = note.contentHtml ?? markdownToHtml(note.content);
  const [editorContent, setEditorContent] = useState(initialHtml);
  const contentRef = useRef({
    html: initialHtml,
    text: note.contentText ?? note.content,
  });
  const titleRef = useRef(note.title);
```

Keep everything from `const pendingRef = useRef<NotePatch>({});` onward.
Delete `lastEditSourceRef`, `displayModeRef` and `previousModeRef` uses elsewhere.

### 4.3 Live-content snapshot (lines 165–185)

Replace the getter with:

```ts
  useEffect(() => {
    const getter = (): NoteContentSnapshot => {
      const html = contentRef.current.html;
      return {
        markdown: serializeNoteSource(html),
        html,
        text: contentRef.current.text,
      };
    };
    onRegisterLiveContent(note.id, getter);
    return () => onRegisterLiveContent(note.id, null);
  }, [note.id, onRegisterLiveContent]);
```

### 4.4 Blur handler (line 235)

Delete this line only:

```ts
      if (displayModeRef.current !== 'preview') return;
```

### 4.5 Mount / focus effects

- Replace the effect at lines 289–291 with:

```ts
  useEffect(() => {
    if (editing) setEditorMounted(true);
  }, [editing]);
```

- In the focus effect at lines 293–318, change the guard to
  `if (!editing || !editor) return;` and change the dependency array to
  `[editing, editor]`.

### 4.6 Escape effect (lines 324–342)

Replace with:

```ts
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
```

### 4.7 Sync effect (lines 374–395)

Replace with:

```ts
  useEffect(() => {
    // While editing, the TipTap document is the source of truth. Persist-only
    // autosaves leave `note` behind the editor, so never let the persisted
    // snapshot overwrite newer local content.
    if (editing || localDirtyRef.current) return;
    if ('contentHtml' in pendingRef.current || 'content' in pendingRef.current) return;
    const html = note.contentHtml ?? markdownToHtml(note.content);
    const text = note.contentText ?? note.content;
    if (html === contentRef.current.html && text === contentRef.current.text) return;
    contentRef.current = { html, text };
    setEditorContent(html);
  }, [editing, note.content, note.contentHtml, note.contentText]);
```

### 4.8 `flush` (lines 397–456)

In the `includeLatestContent` block, delete the `lastEditSourceRef` branch and keep only:

```ts
      if (options?.includeLatestContent) {
        // Only the rich HTML is sent; the repository derives the Markdown source.
        delete pending.content;
        pending.contentHtml = contentRef.current.html;
        pending.contentText = contentRef.current.text;
      }
```

In the title block, replace `titleSource` with `contentRef.current.text`:

```ts
        pending.title = titleFromContent(contentRef.current.text);
```

Change the `flush` dependency array to `[note.id, notify, onUpdateNote, reportSavePending]`
(unchanged) — just make sure no removed refs remain.

### 4.9 Content change

Replace `handleContentChange` (lines 500–513) with:

```ts
  const handleContentChange = useCallback(
    (html: string, text: string) => {
      contentRef.current = { html, text };
      localDirtyRef.current = true;
      localRevisionRef.current += 1;
      reportSavePending(true);
      setEditorContent(html);
      if (text.trim()) clearDiscardTimer();
      // The repository converts this HTML back into the canonical source.
      queueSave({ contentHtml: html, contentText: text });
    },
    [clearDiscardTimer, queueSave, reportSavePending],
  );
```

Delete `handleMarkdownChange` (lines 515–534) entirely.

Delete the mode-switch effect (lines 536–559) entirely.

Delete the Markdown→HTML debounce effect (lines 561–572) entirely.

### 4.10 Insertion effect (lines 583–619)

Replace with the rich-only path:

```ts
  useEffect(() => {
    if (!insertion || !active || insertion.noteId !== note.id) return;
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
  }, [active, editor, insertion, note.id, onInsertionApplied]);
```

### 4.11 Render (lines 621–768)

Replace the derived flags and the body inside `.note-card-scroll` with:

```ts
  const displayTitle = note.kind === 'image' ? 'Canvas image' : noteDisplayTitle(note);
  const showEditor = active && editing;
```

```tsx
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
        {!showEditor ? <NoteHtmlPreview html={editorContent} /> : null}
      </div>
```

In the `onMouseDown` handler (lines 652–663), delete:

```ts
        // The Markdown textarea handles its own pointer interactions.
        if (isMarkdownMode) return;
```

### 4.12 `NoteHtmlPreview` (lines 771–811)

Change the signature and className:

```tsx
function NoteHtmlPreview({ html }: { html: string }) {
```

```tsx
      className={classNames(
        'rich-text-content',
        'note-html-preview',
        'markdown-body',
      )}
```

---

## Step 5 — `src/components/ActiveNoteToolbar.tsx`

1. Icons import → remove `BookOpen` and `SquarePen`:

```ts
import {
  Bold,
  Clipboard,
  ClipboardCopy,
  Download,
  Highlighter,
  List,
  Trash2,
} from 'lucide-react';
```

2. `richText` import → keep only what is used:

```ts
import { htmlToMarkdown } from '../lib/richText';
```

3. Delete the `onToggleDisplayMode` prop from the interface and the destructuring.

4. Delete lines 47–48 (`displayMode` / `isMarkdownMode`).

5. Replace `resolveContent` + `copyElement` with:

```ts
  /** The note's canonical source, preferring the in-memory snapshot while editing. */
  const resolveSource = (): string => {
    const live = getLiveContent(note.id);
    if (live) return live.markdown;
    if (note.content && note.content.trim()) return note.content;
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
```

6. In `downloadElement`, replace its first two lines with `const body = resolveSource().trim();`
   and delete the now-unused `content` variable. Keep the rest unchanged.

7. In the JSX: delete the `isMarkdownMode` conditional around the Bold/Highlight/Bullet
   buttons (render them always), and delete the mode-toggle `IconButton` (lines 172–178).

8. Change the copy button label to `label="Copy note as Markdown"`.

---

## Step 6 — `src/components/CanvasView.tsx`

1. In `NoteNodeData` (line 329), delete:

```ts
  onToggleDisplayMode: (noteId: string) => void;
```

2. Delete the whole `toggleDisplayMode` callback (lines 795–808).

3. Delete these two entries from both `callbacksRef` object literals:
   - `onToggleDisplayMode: toggleDisplayMode,` (lines 838 and 856)

4. In the node-memo comparison (lines 958–972), delete:

```ts
          // A mode toggle must reach the card even mid-session, otherwise the
          // surface and the toolbar icon keep showing the old mode.
          previous.data.note.displayMode === data.note.displayMode &&
```

5. In the `ActiveNoteToolbar` JSX (lines 1795–1803), delete:

```tsx
            onToggleDisplayMode={data.onToggleDisplayMode}
```

6. Update the stale comment in `runFormat` (line 752) from
   “Formatting from preview mode should open the editor first.” to
   “Formatting a note that is not open in the editor should open it first.”

Nothing else in this file changes.

---

## Step 7 — Delete the Markdown editor

```
Remove-Item "src\components\editor\MarkdownEditor.tsx"
```

Confirm no references remain:

```
rg "MarkdownEditor|note-markdown-input|isMarkdownMode|onToggleDisplayMode" src
```

Expected: no output.

---

## Step 8 — CSS

### 8.1 `src/styles/canvas.css`

Delete the two rules at lines 473–499 (the `/* Edit mode shows the note's canonical
Markdown source… */` comment, `.note-card .note-markdown-input`, and
`.note-card .note-markdown-input::placeholder`).

Nothing else in this file changes.

### 8.2 `src/styles/editor.css`

1. Add H5/H6 to the shared heading selector (lines 178–187). The selector becomes:

```css
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
```

2. Add after the `h3` rule (line 199):

```css
.markdown-body h4 {
  font-size: 1em;
}

.markdown-body h5 {
  font-size: 0.94em;
}

.markdown-body h6 {
  color: var(--ink-600);
  font-size: 0.88em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
```

3. Add task-list styling after the `ul`/`ol` block (line 215):

```css
/* Task lists: GFM previews and the editor's taskItem nodes share this markup. */
.markdown-body ul[data-type='taskList'] {
  padding-left: 0;
  list-style: none;
}

.markdown-body ul[data-type='taskList'] > li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 0.4em;
}

.markdown-body ul[data-type='taskList'] > li > label {
  flex: 0 0 auto;
  margin-top: 0.4em;
}

.markdown-body ul[data-type='taskList'] > li > div {
  flex: 1 1 auto;
  min-width: 0;
}

.markdown-body ul[data-type='taskList'] > li > div > p {
  margin-bottom: 0.35em;
}

.markdown-body li > input[type='checkbox'] {
  margin: 0 0.15em 0 0;
  vertical-align: middle;
  accent-color: var(--accent);
}
```

---

## Step 9 — `README.md`

Replace the **Writing** section bullets (currently lines 69–77) with:

```md
- Every element stores its content as **Markdown** (or plain text when it has no formatting), the canonical source, and is always shown rendered. There is no separate Markdown editor or preview toggle.
- Click an element to edit it in place. Type Markdown shortcuts and they convert as you go: `#` headings, `-` and `1.` lists, `>` quotes, fenced code, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, and `[label](url)` links.
- Use the selected-element toolbar for bold text, highlights, bullet lists, copying, downloading the element as a Markdown file, inserting page text, and deleting the element.
- Elements that are not being edited stay rendered on the canvas.
- Pasting Markdown or rich HTML from a page or ChatGPT keeps its structure: tables stay tables, headings stay headings, lists stay lists, and task lists keep their checkboxes.
- Changes autosave after a configurable pause and flush when editing ends.
- The **insert selected text** action appends the current browser selection to the active element while preserving its formatting, including lists, headings, and tables.
- **Ctrl+C** with text selected copies just that selection as Markdown (`text/plain` only); with nothing selected it does nothing. The toolbar's **Copy** button copies the whole element's stored Markdown/plain-text source, so pasting into another element, editor, or chat keeps the syntax. Local images stay as `![alt](attachment://id)`.
- **Download** saves the element as a `.md` file with a Save As dialog so you can choose the destination.
```

---

## Step 10 — Verification

1. Typecheck and build:

```
npm.cmd run typecheck
npm.cmd run build
```

Fix any `noUnusedLocals` / `noUnusedParameters` errors caused by removed code
(likely candidates: leftover imports in `NoteCard.tsx`, `ActiveNoteToolbar.tsx`,
`CanvasView.tsx`, `MarkdownEditor` references).

2. No stale references:

```
rg "MarkdownEditor|isMarkdownMode|onToggleDisplayMode|note-markdown-input|note-display-"
rg "displayMode" src/components src/lib
```

Both should return no matches. (`displayMode` may still appear in
`src/services/**` and `src/types/**` — that is intentional.)

3. Manual checks (load the unpacked extension, open a canvas):
   - Plain-text note: open, type, leave, reopen → still plain, no `*`/`-` added.
   - Markdown note with H1–H6, lists, quote, fence, table, link, task list → rendered while idle, editable while active, unchanged after reopen.
   - Type `# `, `- `, `1. `, `> `, ```` ``` ````, `**bold**`, `*italic*`, `` `code` ``, `[label](https://example.com)`, `- [ ] ` and `- [x] ` → each converts immediately.
   - Select part of a note, Ctrl+C, paste into a text editor → Markdown of just that selection, no HTML flavour.
   - Ctrl+C with a caret and no selection → clipboard unchanged.
   - Toolbar Copy on a plain note → plain text; on a formatted note → Markdown source; on an image note → `![alt](attachment://id)`.
   - Copy while mid-edit (unsaved changes) → copies the current document, not the last autosave.
   - Checkbox in the editor toggles and survives reopen.
   - Escape ends editing; the note renders again; single-click zoom still works.
   - Export/import a canvas and back up/restore a notebook → notes still load.

---

## Behaviour notes (do not “fix” these)

- The first WYSIWYG edit of a note normalizes equivalent Markdown (`*` → `-` bullets,
  `__bold__` → `**bold**`, setext → ATX). Untouched notes keep their exact source.
- Literal characters that look like markers are backslash-escaped in the stored source
  so they stay literal on reopen; whole-note copies can therefore contain backslashes
  in those rare cases.
- Partial-selection copies are rebuilt from rendered HTML; a selection that starts or
  ends mid-structure may differ slightly from the original source formatting.
- Notes whose stored `contentHtml` predates this change may render an imported task list
  as a plain bullet list until they are edited once. `content` still contains the
  checkbox syntax.
- `attachment://` references are not portable outside ClipCanvas (by design).
- There is no source editor of any kind (by design).




Here's the consolidated plan based on your decisions. Nothing has been modified.

Here's the consolidated plan based on your decisions. **Nothing has been modified.**

## Decisions locked

| Area | Decision |
|---|---|
| Source of truth | `content` stays canonical Markdown/plain text; `contentHtml` remains the render cache |
| Typing | Markdown converts as you type |
| Ctrl+C with selection | Copy only the selection, as Markdown, `text/plain` |
| Ctrl+C with no selection | Do nothing (native) |
| Toolbar Copy | Copy the whole note's stored source |
| Images | Keep `![alt](attachment://id)` references |
| Raw source | No source editor at all |
| Coverage | Headings H1–H6, task lists, links, tables, underline all supported |

## Target behaviour

- **Viewing:** every idle note renders from `contentHtml` (already true). No syntax is ever shown, including while editing.
- **Editing:** TipTap is the only surface. Clicking a note keeps the current zoom behaviour and opens the rich editor; the rendered look is preserved because both use the same `markdown-body` styles.
- **Saving:** `contentHtml` stores the editor document; `content` is regenerated from it only when the document actually changed. Untouched notes keep their exact source bytes.
- **Serialization:** two modes —
  - *Storage:* if the document contains only paragraphs and line breaks, write plain text with blank lines between paragraphs and no Markdown markers. Otherwise serialize to Markdown, escaping literal marker characters so they don't turn into formatting on reopen. Existing custom rules (attachments, `<mark>`, `<u>`, tables, code blocks, strikethrough) carry over, plus a new task-item rule.
  - *Clipboard (selection):* serialize the selection HTML to Markdown **without** escaping ordinary text, so prose stays prose. Whole-note copies bypass conversion and use the stored source verbatim.
- **Rendering:** `marked` (GFM, `breaks: true`) → `sanitize-html`, unchanged. Mixed prose/Markdown already works because unmatched text passes through.

## Implementation outline

**Content pipeline — `src/lib/richText.ts`**
- Add `serializeNoteSource(html)` (storage serializer) and `htmlToMarkdownForCopy(html)` (clipboard serializer).
- Add a Turndown rule for TipTap task items (`li[data-type="taskItem"]` → `- [x]` / `- [ ]`), since the GFM plugin only recognises a checkbox that is a direct child of `<li>`.
- Change `clipboardToNote` so Inline-only Markdown pasted as plain text is rendered when no richer HTML flavour is present.
- Extend the sanitizer whitelist for task lists (`input`, `label`, `div`, `data-type`, `data-checked`, checkbox attributes).

**Editor — `src/components/editor/RichTextEditor.tsx`**
- Headings 1–6.
- Add `@tiptap/extension-task-list` and `@tiptap/extension-task-item` (v3.32.2, matching the installed TipTap).
- Add inline mark input rules for bold, italic, strike, inline code (and optionally links). Structural input rules for headings, lists, blockquote, and code fences already ship with StarterKit.
- Intercept the `copy` event: non-empty selection → Markdown of the selection in `text/plain` only; collapsed selection → let the browser handle it.
- Keep the existing structured-paste handling, extended to inline Markdown.

**Note card — `src/components/NoteCard.tsx`**
- Remove the `displayMode`/`isMarkdownMode` branches, the `MarkdownEditor` surface, and the mode-switch sync effect.
- Always render `RichTextEditor` while editing; simplify the live-content snapshot to derive from the editor HTML through the storage serializer.

**Toolbar — `src/components/ActiveNoteToolbar.tsx`**
- Remove the Editor/Preview toggle and the visibility condition on format buttons.
- Copy action writes the whole note's source as `text/plain` only (no `text/html` flavour anywhere).
- Keep Download as Markdown unchanged.

**Canvas — `src/components/CanvasView.tsx`**
- Remove `toggleDisplayMode` and its prop plumbing; remove the `displayMode` comparison in the node memo.
- Add a canvas-level `copy` listener for selections in idle rendered notes (outside inputs, editors, search, settings, dialogs), converting the selected range to Markdown.

**Storage & compatibility**
- Keep `displayMode` in existing records, backups, and canvas-transfer files but **stop reading/writing it in the UI**. No DB version bump, so older data and files keep working.
- `editorMode` remains a dormant legacy setting.
- Delete `src/components/editor/MarkdownEditor.tsx` and the `.note-markdown-input` styles; add task-list styles for editor and preview.
- Update `README.md` to describe the single WYSIWYG behaviour and copy semantics.


### 5. Expected Behaviour — Practical Scenarios

Please use the following scenarios as acceptance criteria when designing the implementation.

**Scenario 1: Plain-text note**
- I paste ordinary text into a new note.
- The note displays ordinary text without unnecessary formatting.
- I can edit it directly in the WYSIWYG editor.
- Copying through the toolbar returns the original plain text.

**Scenario 2: Markdown note**
- I paste Markdown containing headings, bold text, bullet points, tables, and links.
- The canvas immediately displays the properly rendered content, not Markdown syntax.
- When I edit the note, I continue seeing and editing the formatted content.
- After saving and reopening, the formatting remains intact.
- Toolbar Copy returns the original Markdown source.

**Scenario 3: Mixed plain text and Markdown**
- I paste content containing ordinary paragraphs alongside Markdown headings, bold text, and lists.
- Ordinary text remains ordinary text.
- Markdown elements are automatically rendered.
- Both types of content remain together in their original order.
- Editing must not accidentally convert ordinary paragraphs into unwanted Markdown formatting.

**Scenario 4: Markdown typed directly**
- I type `# Research Topic` in the editor.
- It automatically converts into a rendered heading.
- I type `**Important**` and it becomes bold.
- I create a bullet list using Markdown syntax.
- The editor displays the formatted result without leaving the Markdown syntax visible.

**Scenario 5: Copying selected content**
- If I select a heading or paragraph and press Ctrl+C, only the selected content is copied.
- The clipboard contains Markdown/plain-text content, not HTML.
- If nothing is selected, Ctrl+C follows native editor behaviour and does nothing.
- The toolbar Copy icon always copies the entire note's original stored source.

**Scenario 6: Existing notes**
- Existing plain-text and Markdown notes must continue working.
- Opening a note must not modify its stored source.
- Untouched notes must preserve their original content exactly.
- Only actual edits should trigger serialization and potential Markdown normalization.

These scenarios describe the expected user experience, not a requirement to implement a particular technical solution. Please identify any scenario that the proposed architecture cannot fully support before implementation.

Do not start coding yet. First update the plan and discuss any remaining limitations with me.


## Known limitations to accept

- A note's **first** WYSIWYG edit normalises equivalent Markdown (`*` → `-` bullets, `__bold__` → `**bold**`). Untouched notes are preserved exactly.
- Literal Markdown characters that survive typing are escaped in the stored source, so whole-note copies can contain backslashes in those rare cases.
- Partial-selection copies are reconstructed from rendered HTML; deeply nested structures or partial tables may come out slightly differently from the original source.
- Raw HTML outside the editor schema (e.g. `<details>`) is dropped when a note is edited.
- `attachment://` references are not portable outside ClipCanvas (by choice).
- There is no way to repair raw source after this change (by choice).

The overall plan looks good. Before implementation, I want you to incorporate the following additional clarifications:

1. **Mixed Content Handling:** A single note can contain both ordinary plain text and Markdown. The application must render supported Markdown wherever it appears while keeping ordinary text unchanged. Avoid unnecessarily interpreting normal prose as Markdown.

2. **Copy Behaviour:**
   - Toolbar Copy: Copy the entire original stored content, preserving its Markdown syntax and ordinary text.
   - Ctrl+C with a selection: Copy only the selected content as Markdown/plain-text source.
   - Ctrl+C without a selection: Do nothing (native behaviour).
   - Never add an HTML clipboard format.

3. **Editing and Content Preservation:** Editing must happen entirely through the rendered WYSIWYG interface. Markdown syntax must never be exposed in the normal UI. Untouched notes must retain their original source exactly. Editing should preserve existing formatting and content wherever technically possible.

4. **Content Loss Prevention:** Before implementation, identify any existing or potentially unsupported Markdown, HTML, or other content structures that could be lost or altered during WYSIWYG editing. Do not silently discard unsupported content. Explain the potential limitations and propose how to handle them before proceeding.

Please update the consolidated plan to incorporate these clarifications. Do not modify any code yet. I want to review the final plan and explicitly approve it before you begin implementation.

## Verification

`npm.cmd run typecheck` and `npm.cmd run build`, then manual checks on plain, Markdown, and mixed notes: rendered view, editing, reopen, whole-note and selection copy, H4–H6, task lists, tables, links, images, plus a backup export/import and canvas transfer round-trip. No automated tests, per the standing rule.

---

If this matches what you want, switch out of Plan mode and I'll implement it. If any of the serialization or copy details should be adjusted first, tell me which.

---

# Revision 2 — approved clarifications (supersedes the above where they conflict)

Approved after reviewing the plan and the six acceptance scenarios.

**Status: implemented.** All files in §R2.8 are changed, `npm.cmd run typecheck` and
`npm.cmd run build` both pass, and the stale-reference greps return nothing. Only the
manual browser checks in §R2.10 remain. `preservedSource` was chosen as the field name
and the one-time archive toast was kept.

## R2.1 Decisions locked in this round

| Question | Decision | Effect |
|---|---|---|
| Ctrl+C on an **idle, non-editing** rendered note (canvas preview) | **Native browser copy.** Do nothing. | The canvas-level copy listener mentioned in the merged summary is **dropped**. `CanvasView.tsx` only loses `toggleDisplayMode` plumbing; no copy handler is added. |
| Unsupported content on first edit | **Preserve raw source.** Never silently discard. | New persisted field `preservedSource` (see §R2.3). This forces three files off the do-not-touch list. |
| Order of work | **Update this plan first, get approval, then code.** | This section. |

## R2.2 Scope change — three files leave the "do not touch" list

`preservedSource` must survive storage, backup export, backup import and canvas
transfer. Those paths **whitelist note fields explicitly**, so an unlisted field is
silently dropped:

- `src/services/db/repository.ts:258` `cleanStoredNote()` rebuilds every `Note` from an
  explicit field list — a new field is stripped on **every notebook load** (line 326
  `notes: notes.map(cleanStoredNote)`).
- `src/services/import-export/backup.ts:162` writes notes field-by-field; line 361+
  reads them field-by-field.
- `src/services/import-export/canvasTransfer.ts:198` writes field-by-field; lines
  339+, 483+ read field-by-field.

**Therefore these move from "do not touch" to "must touch":**

| File | Change |
|---|---|
| `src/types/index.ts` | Add one optional field to `Note` (no other change) |
| `src/services/import-export/backup.ts` | Export + import `preservedSource` |
| `src/services/import-export/canvasTransfer.ts` | Export + import `preservedSource` |

`src/services/db/database.ts` stays untouched: IndexedDB stores plain objects, so an
optional property needs **no store/index change and no `SCHEMA_VERSION` bump**
(`SCHEMA_VERSION` stays `3`; the existing `contentHtml`/`contentText` optional fields
prove the pattern works). `src/App.tsx`, `src/popup/PopupApp.tsx`, `tests/*` stay
untouched.

## R2.3 `preservedSource` — the content-loss safety net

### Field

```ts
  /**
   * The note's Markdown/plain source as it was immediately before its first
   * WYSIWYG edit. TipTap cannot represent every construct a Markdown file can
   * contain, so the original is archived here the first time an edit rewrites
   * `content`. It is never rendered, never edited, and never shown in the UI;
   * it exists so unsupported markup is recoverable instead of silently lost.
   */
  preservedSource?: string;
```

Added to `Note` in `src/types/index.ts`. **Not** added to `NoteInput`, `NotePatch`,
`NoteContentSnapshot`, `BackupFile`'s explicit shape (it rides along `Note[]`),
`NotebookDataset` or `AppSettings`.

### Write rule (repository only)

One write, one condition, in `updateNote()` next to the existing `content`
recomputation:

```ts
  // Archive the pre-edit source the first time an edit rewrites it. Unsupported
  // constructs the editor cannot represent stay recoverable instead of vanishing.
  let preservedSource = existing.preservedSource;
  if (
    preservedSource === undefined &&
    patch.contentHtml !== undefined &&
    existing.content.trim() !== '' &&
    content !== existing.content
  ) {
    preservedSource = existing.content;
  }
```

- Set **once per note**; never overwritten by later edits.
- Not set when the source is unchanged (opening and closing a note archives nothing).
- Not set for brand-new notes (`existing.content` empty).
- `content` remains the live canonical source, so rendering, search, title fallback
  and toolbar Copy keep using it exactly as today.

### Plumbing

| Location | Change |
|---|---|
| `repository.ts` `buildNote()` | carry through from input-less notes → `preservedSource: undefined` is absent; no change needed for new notes |
| `repository.ts` `cleanStoredNote()` | `...(note.preservedSource ? { preservedSource: note.preservedSource } : {})` |
| `repository.ts` `updateNote()` | the write rule above + include the field in the `updated` object |
| `backup.ts` export | `...(note.preservedSource ? { preservedSource: note.preservedSource } : {})` |
| `backup.ts` import | read optional string with the same length cap as `content`; ignore if absent |
| `canvasTransfer.ts` type | add `preservedSource?: string` to the transfer note shape |
| `canvasTransfer.ts` export | write it when present |
| `canvasTransfer.ts` import | read it, write it into the created note |

### Recovery signal (recommended — veto if unwanted)

Silently archiving still means the user sees formatting disappear. Add one helper and
one toast:

```ts
/** True when the Markdown contains HTML the note schema cannot represent. */
export function hasUnsupportedMarkup(markdown: string): boolean {
  const allowed = new Set([...NOTE_TAGS]);
  return [...markdown.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)].some(
    ([, tag]) => !allowed.has(tag.toLowerCase()),
  );
}
```

In `NoteCard.tsx`, when an edit session begins on a note with
`hasUnsupportedMarkup(note.content) && !note.preservedSource`, fire **one** info toast
per note per session: *"Some formatting can't be edited here. The original text is
kept in this element's archive."* No dialog, no blocking, no new UI surface.

## R2.4 Audit — what can be lost or altered by WYSIWYG editing

Legend: **Render today** = what the user currently sees (`marked` → `sanitize-html` →
`contentHtml`). **After edit** = what survives into `content`. Anything already
stripped at render time is *invisible* today, so archiving it is a strict improvement,
not a regression.

| # | Construct | Render today | After first edit | Handling |
|---|---|---|---|---|
| 1 | Raw HTML blocks: `<details>`, `<summary>`, `<dl>`, `<figure>`, `<figcaption>`, `<iframe>`, `<video>`, `<audio>`, `<svg>`, `<style>`, `<script>` | Stripped (not in whitelist) | Dropped | **`preservedSource`** |
| 2 | Inline HTML: `<kbd>`, `<sub>`, `<sup>`, `<abbr>`, `<small>`, `<font>`, `<cite>` | Stripped | Dropped | **`preservedSource`** |
| 3 | HTML comments `<!-- … -->` | Stripped | Dropped | **`preservedSource`** |
| 4 | Inline `style=` / `class=` / other `data-*` attributes | Stripped (no `style` in whitelist) | Dropped | **`preservedSource`** (no visible change) |
| 5 | `<mark>` highlight | ✅ Kept | ✅ Kept (custom mark + Turndown rule) | none |
| 6 | `<u>` underline | ✅ Kept | ✅ Kept (custom mark + Turndown rule) | none |
| 7 | Tables (basic) | ✅ Kept | ✅ Kept | none |
| 8 | Table `colspan` / `rowspan` | Attribute allowed | **Flattened** — TipTap tables have no span model | **`preservedSource`** |
| 9 | Table `<caption>`, `<colgroup>`, `<col>`, `<tfoot>` | Stripped | Dropped | **`preservedSource`** |
| 10 | Table cell alignment (`:--:`) | Not rendered | Lost | **`preservedSource`** |
| 11 | Nested tables | Rendered oddly | Collapsed | **`preservedSource`** |
| 12 | Images `data-attachment-id` | ✅ Kept | ✅ Kept (`AttachmentImage`) | none |
| 13 | Images with remote `src` | ✅ Kept | ✅ Kept (`img[src]` parse rule) | none |
| 14 | Image `height` attribute | Allowed | Dropped (node has no `height` attr) | **`preservedSource`** |
| 15 | Reference-style links (`[a]: https://…` + `[a]`) | ✅ Resolved | Converted to inline links; **definition lines vanish** | **`preservedSource`** |
| 16 | Front matter (`---\ntitle: …\n---`) | Renders as `<hr>` + text | Normalized to `---` + paragraph | **`preservedSource`** |
| 17 | Footnotes `[^1]` | Not enabled by `gfm: true`; shown literally | Shown literally (no loss) | none |
| 18 | Task lists `- [ ]` | Currently **degrades to bullets** | ✅ Preserved + toggleable | this change (Step 2.2) |
| 19 | Code fence language (` ```ts `) | ✅ `class="language-ts"` | ✅ Kept (`code` class allowed) | none |
| 20 | Indented (4-space) code blocks | ✅ Rendered | Converted to fenced | normalisation (accepted) |
| 21 | Escape sequences (`\*`, `\_`, `\#`) | ✅ Literal char | Re-escaped on store | round-trips |
| 22 | Entities (`&nbsp;`, `&mdash;`, `&hellip;`) | Decoded | Stored as the literal character | round-trips |
| 23 | Setext headings (`===`, `---` under line) | ✅ `h1`/`h2` | Converted to ATX (`#`) | normalisation (accepted) |
| 24 | `*`/`+` bullet markers, `__bold__`, `_italic_` | ✅ Rendered | Normalised to `-`, `**`, `*` | normalisation (accepted) |
| 25 | Loose vs tight list spacing | ✅ Rendered | Respacing possible | cosmetic |
| 26 | Hard breaks (two trailing spaces) | `<br>` | Preserved as `  \n` | none |
| 27 | Custom/unknown attributes on any allowed tag | Stripped | Dropped | **`preservedSource`** (no visible change) |

**Net effect for the user:** nothing that renders today stops rendering. The only
visible losses are the three normalisations the plan already accepted (`*`→`-`,
`__b__`→`**b**`, setext→ATX, indented→fenced), and every dropped construct is
recoverable from `preservedSource`.

## R2.5 Copy semantics — final

| Action | Surface | Writes to clipboard |
|---|---|---|
| Ctrl+C, selection non-empty | Editor (TipTap) | Markdown of the **selection only**, `text/plain` only |
| Ctrl+C, selection empty | Editor | Nothing; native handling, return `false` |
| Ctrl+C | Idle rendered note | **Native browser behaviour** (unchanged, no interception) |
| Toolbar Copy | Selected note | Whole note's current canonical source (`content`, or live snapshot while editing), `text/plain` only |
| Toolbar Copy (image note) | Selected note | `![alt](attachment://id)` |
| Any copy path | — | **No `text/html` flavour is ever written** |

`preservedSource` is **not** copied by the toolbar Copy button — that button
represents the live note. The archive exists for recovery, not for copying.

## R2.6 Scenario acceptance matrix

| Scenario | Fully supported? | How | Caveat |
|---|---|---|---|
| **1. Plain-text note** | ✅ Yes | `isPlainTextDocument()` + `plainTextFromParagraphs()`; paragraphs ↔ blank lines, no markers | None |
| **2. Markdown note** | ✅ Yes (with normalisation) | `marked` GFM render, TipTap edit, `serializeNoteSource` store | First edit normalises equivalent syntax (#23, #24) |
| **3. Mixed plain + Markdown** | ✅ Yes | Block-level Markdown renders; prose paragraphs pass through untouched; storage only escapes literal markers | Prose that *is* valid Markdown (`- ` at line start, `1. `, `# `) **will** render as Markdown — that is Markdown itself, not a bug; cannot be disabled without breaking Scenario 4 |
| **4. Markdown typed directly** | ✅ Yes | StarterKit input rules + `MarkdownLinkInputRule` (Step 3.2) | `[label](url)` rule fires on the closing `)` only |
| **5. Copying selected content** | ✅ Yes | `handleDOMEvents.copy` → `htmlToMarkdownForCopy` → `setData('text/plain')` | Partial selections rebuilt from HTML; a selection starting mid-structure may differ cosmetically |
| **6. Existing notes** | ✅ Yes | No write until an actual change; `content` unchanged on open/close; `preservedSource` captures anything the editor drops | Backup/transfer must carry the new field (R2.2) or it would be lost on export |

## R2.7 Correction to Step 5 (`ActiveNoteToolbar.tsx`)

The plan's `resolveSource()` falls back to `htmlToMarkdown(note.contentHtml)`, which is
lossy for a note that has never been edited. It copies the **rendered** normalisation
instead of the stored source. Use the stored source directly:

```ts
  const resolveSource = (): string => {
    const live = getLiveContent(note.id);
    if (live) return live.markdown;
    // Stored source is canonical; contentHtml is only a render cache and must not
    // be re-serialised for copying.
    if (note.content.trim()) return note.content;
    return note.contentHtml ? htmlToMarkdown(note.contentHtml) : '';
  };
```

The `htmlToMarkdown` import stays only for the empty-`content` fallback.

## R2.8 Revised implementation order

1. `npm.cmd install` — **required**, see R2.9.
2. `package.json` — add `@tiptap/extension-list`.
3. `src/types/index.ts` — add `preservedSource`.
4. `src/lib/richText.ts` — Steps 2.1–2.5 + `hasUnsupportedMarkup`.
5. `src/services/db/repository.ts` — Step 3 + `preservedSource` plumbing.
6. `src/services/import-export/backup.ts` — carry `preservedSource`.
7. `src/services/import-export/canvasTransfer.ts` — carry `preservedSource`.
8. `src/components/editor/RichTextEditor.tsx` — Steps 3.1–3.5.
9. `src/components/NoteCard.tsx` — Steps 4.1–4.12 + archive toast.
10. `src/components/ActiveNoteToolbar.tsx` — Step 5 with the R2.7 correction.
11. `src/components/CanvasView.tsx` — Step 6 only (no copy listener).
12. Delete `src/components/editor/MarkdownEditor.tsx`; remove dead references.
13. CSS — Step 8.
14. `README.md` — Step 9, plus one bullet on the archive.
15. Verification — R2.10.

## R2.9 Environment finding (blocker if ignored)

`node_modules` **does not exist** in this checkout; only `package-lock.json` does. The
original Step 1 fallback ("if the install cannot reach the network, skip it — the
package already exists in `node_modules`") is **false on this machine**.
`package-lock.json` already pins `@tiptap/extension-list@3.32.2`, so adding the
dependency will not conflict — but `npm.cmd install` must run successfully (network or
a warm npm cache) before `typecheck`/`build` mean anything.

## R2.10 Verification (revised)

```
npm.cmd run typecheck
npm.cmd run build
```

No `npm test`, no commit. Then:

- **Archive round-trip:** note containing `<details>` and a `colspan` table → edit a
  word → save → `preservedSource` holds the original string → export backup → import
  into a clean profile → `preservedSource` still present → export canvas → import
  canvas → still present.
- **No false archiving:** open a plain note, change nothing, close → `preservedSource`
  absent.
- **One-shot archiving:** edit a note twice → `preservedSource` equals the pre-first-
  edit source, unchanged by the second edit.
- **Scenarios 1–6** as listed in R2.6, plus: toolbar Copy on an *unedited* Markdown
  note returns the byte-exact stored source (validates R2.7).
- `rg "MarkdownEditor|isMarkdownMode|onToggleDisplayMode|note-markdown-input"` → empty.
- `rg "displayMode" src/components src/lib` → empty.

## R2.11 Open items needing your explicit approval

1. **Field name** `preservedSource` (alternatives: `legacySource`, `sourceArchive`).
2. **Touching `types/index.ts`, `backup.ts`, `canvasTransfer.ts`** — unavoidable for a
   durable archive; confirm the scope change in R2.2.
3. **Archive toast** (R2.3, recommended) — keep or drop.
4. **Idle-preview Ctrl+C stays native** — confirm we are *not* adding a canvas copy
   listener, so selection copy inside an idle rendered note yields whatever the browser
   produces (text + HTML from the DOM), not Markdown.

