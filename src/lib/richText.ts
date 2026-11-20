import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { isTabularText, tabularTextToMarkdown } from './tabular';

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

/**
 * Block wrappers that common clipboard implementations use instead of
 * paragraphs (`<div>`, `<section>`, ...). They are not part of the note schema,
 * but dropping them before conversion joined adjacent lines into one word
 * (`<div>one</div><div>two</div>` became `onetwo`). Keep them only while a
 * clipboard payload is being converted to Markdown, then render stored HTML
 * from that Markdown so the notes themselves never contain foreign wrappers.
 */
const CLIPBOARD_BLOCK_TAGS = [
  'address',
  'article',
  'aside',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'header',
  'main',
  'nav',
  'section',
] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/**
 * Converts meaningful newline characters inside text nodes to hard breaks.
 * Some Markdown renderers keep single newlines as literal "\n" characters in
 * the HTML, which the browser's default white-space shrinks and ProseMirror
 * turns into spaces, so the same note looked different in read and edit mode.
 * Canonicalizing to `<br>` keeps both renderers identical.
 */
function preserveTextLineBreaks(html: string): string {
  let preDepth = 0;
  return html
    .split(/(<[^>]*>)/g)
    .map((part) => {
      if (!part) return part;
      if (part.startsWith('<')) {
        if (/^<pre(?:\s|>)/i.test(part)) preDepth += 1;
        else if (/^<\/pre\s*>/i.test(part)) preDepth = Math.max(0, preDepth - 1);
        return part;
      }
      // Indentation between block tags is formatting whitespace, not a line
      // break the user can see. Keep it untouched.
      if (preDepth > 0 || !/[\r\n]/.test(part) || !part.trim()) return part;
      // A newline at the edge of a text node is source indentation, not a
      // visible break. Converting it produced blank lines whenever captured
      // page HTML wrapped its text in <div>s (for example ChatGPT answers).
      return part
        .replace(/\r\n?/g, '\n')
        .replace(/^\n+|\n+$/g, ' ')
        .replace(/\n/g, '<br>');
    })
    .join('');
}

function sanitizeWithTags(html: string, extraTags: readonly string[] = []): string {
  if (!html.trim()) return '';
  return sanitizeHtml(preserveTextLineBreaks(html), {
    allowedTags: [...NOTE_TAGS, ...extraTags],
    allowedAttributes: NOTE_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noreferrer noopener',
          target: '_blank',
        },
      }),
    },
  });
}

/** Sanitizes rich note HTML while preserving the nodes used by the editor. */
export function sanitizeNoteHtml(html: string): string {
  return sanitizeWithTags(html);
}

/** Keeps block wrappers while importing clipboard HTML, then converts it. */
function sanitizeClipboardHtml(html: string): string {
  return sanitizeWithTags(html, CLIPBOARD_BLOCK_TAGS);
}

const ATTACHMENT_IMAGE = /!\[([^\]]*)\]\(attachment:\/\/([^)\s]+)\)/g;

/**
 * Markdown has no notion of a local attachment, so ClipCanvas stores images as
 * `![alt](attachment://id)` in the source and restores the editor's
 * `data-attachment-id` attribute when rendering.
 */
function restoreAttachmentImages(markdown: string): string {
  return markdown.replace(ATTACHMENT_IMAGE, (_match, alt: string, id: string) => {
    return `<img data-attachment-id="${id}" alt="${escapeHtml(alt)}" />`;
  });
}

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

/**
 * Block elements that ProseMirror's `TrailingNode` extension refuses to end a
 * document with: when the last node is not a paragraph, it adds an empty
 * paragraph after it.
 */
const TRAILING_PARAGRAPH_BLOCKS = new Set([
  'UL',
  'OL',
  'TABLE',
  'BLOCKQUOTE',
  'PRE',
  'HR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

function emitsTrailingParagraph(element: Element | null): boolean {
  if (!element) return false;
  // The sanitizer keeps clipboard `<div>` wrappers, which ProseMirror unwraps
  // before it decides what the document's last block is.
  if (element.tagName === 'DIV') return emitsTrailingParagraph(element.lastElementChild);
  return TRAILING_PARAGRAPH_BLOCKS.has(element.tagName);
}

/**
 * Gives the read-only preview the empty paragraph the editor always keeps after
 * a document that ends with a non-paragraph block.
 *
 * ProseMirror's `TrailingNode` extension guarantees `getHTML()` ends with a
 * paragraph, so an edited note always reserved one blank line (plus the list's
 * bottom margin) below its last bullet. HTML rendered straight from Markdown
 * has no such paragraph, so that spacing disappeared as soon as the note lost
 * focus. Appending it here keeps both modes identical without rewriting data.
 */
export function ensureTrailingParagraph(html: string): string {
  if (typeof document === 'undefined' || !html.trim()) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  if (!emitsTrailingParagraph(template.content.lastElementChild)) return html;
  return `${html}<p></p>`;
}

/** Converts Markdown (the canonical note source) into editor HTML. */
export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return '';
  try {
    const rendered = marked.parse(restoreAttachmentImages(markdown), {
      async: false,
      gfm: true,
      breaks: true,
    }) as string;
    return sanitizeNoteHtml(normalizeTaskLists(rendered));
  } catch {
    return `<p>${escapeHtml(markdown).replace(/\n/g, '<br>')}</p>`;
  }
}

/**
 * True when a plain-text payload is almost certainly Markdown rather than
 * literal prose. Clipboard data from ChatGPT, GitHub, and most documentation
 * sites arrives this way when no `text/html` flavour is offered.
 */
export function looksLikeMarkdown(value: string): boolean {
  if (!value.trim()) return false;
  return (
    /(^|\n)\s{0,3}(#{1,6}\s|>\s|```|~~~|[-*+]\s|\d{1,9}[.)]\s)/.test(value) ||
    /(^|\n)\s*\|.*\|\s*(\n|$)/.test(value) ||
    /\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)/.test(value)
  );
}

const STRUCTURED_HTML =
  /<(table|thead|tbody|tr|td|th|ul|ol|li|pre|blockquote|h[1-6]|hr|dl|figure|div|section|article|header|footer|main|aside)\b/i;

/** True when HTML carries block structure that Markdown can represent. */
export function htmlHasBlockStructure(html: string): boolean {
  return STRUCTURED_HTML.test(html);
}

/**
 * True when a clipboard payload contains block structure worth normalizing.
 * Inline-only pastes (a word, a link, bold text) keep the browser's native
 * paste so they land exactly where the caret is.
 */
export function isStructuredClipboard(html: string, text: string): boolean {
  if (html.trim() && htmlHasBlockStructure(html)) return true;
  return looksLikeMarkdown(text) || isTabularText(text);
}

/**
 * True when a plain-text payload carries block-level Markdown. Unlike
 * `looksLikeMarkdown`, inline emphasis alone does not count: rendered text with
 * a stray `**` should still prefer the rich HTML flavour.
 */
export function looksLikeBlockMarkdown(value: string): boolean {
  if (!value.trim()) return false;
  return (
    /(^|\n)\s{0,3}(#{1,6}\s|>\s|```|~~~|[-*+]\s|\d{1,9}[.)]\s)/.test(value) ||
    /(^|\n)\s*\|.*\|\s*(\n|$)/.test(value)
  );
}

export interface ClipboardPayload {
  html?: string;
  text?: string;
}

export interface NoteClipboardContent {
  /** Canonical Markdown source for the note. */
  markdown: string;
  /** Rendered, sanitized HTML used by the preview and the rich editor. */
  html: string;
}

function normalizeClipboardText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The single normalization path for every way content enters an element.
 *
 * Markdown wins when the plain-text flavour is block-level Markdown (ChatGPT's
 * copy button, GitHub, documentation sites), because that is the source the
 * user expects to see and copy later. Otherwise the rich HTML flavour is
 * sanitized and converted back to Markdown, which keeps tables and lists from
 * ordinary page selections. The stored HTML is then rendered from that Markdown
 * so both representations always agree. Literal prose stays literal.
 */
export function clipboardToNote({ html, text }: ClipboardPayload): NoteClipboardContent {
  const plain = normalizeClipboardText(text ?? '');
  const rich = html?.trim() ? sanitizeClipboardHtml(html) : '';

  if (plain && (looksLikeBlockMarkdown(plain) || (!rich && looksLikeMarkdown(plain)))) {
    return { markdown: plain, html: markdownToHtml(plain) };
  }
  const tabular = plain && isTabularText(plain) ? tabularTextToMarkdown(plain) : '';
  if (rich) {
    const markdown = htmlToMarkdown(rich);
    // Keep the HTML when it produced a real Markdown table: it preserves inline
    // formatting. A raw `<table>` (no header row) and a flattened block-per-cell
    // selection both fall back to the tab-separated grid, which is unambiguous
    // and stays Markdown.
    const hasGfmTable = /(^|\n)\s*\|[^\n|]*\|/.test(markdown);
    if (tabular && !hasGfmTable) {
      return { markdown: tabular, html: markdownToHtml(tabular) };
    }
    return { markdown, html: markdownToHtml(markdown) };
  }
  if (tabular) return { markdown: tabular, html: markdownToHtml(tabular) };
  if (!plain) return { markdown: '', html: '' };
  return { markdown: plain, html: plainTextToHtml(plain) };
}

/** HTML-only convenience wrapper used by the rich editor's paste handler. */
export function clipboardToNoteHtml(payload: ClipboardPayload): string {
  return clipboardToNote(payload).html;
}

/**
 * Converts literal plain text to editor HTML. Blank lines separate paragraphs,
 * single newlines stay hard breaks, and runs of bullet/numbered lines become
 * real lists. Clipboard data without an HTML flavour often arrives this way;
 * wrapping everything in one paragraph made copied bullet lists lose their
 * structure.
 */
export function plainTextToHtml(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return '';

  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listStart = 1;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const content = paragraph.join('\n').replace(/^\n+|\n+$/g, '');
    paragraph = [];
    if (!content.trim()) return;
    html.push(`<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`);
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    const attrs = listType === 'ol' && listStart !== 1 ? ` start="${listStart}"` : '';
    const items = listItems
      .map((item) => `<li>${escapeHtml(item).replace(/\n/g, '<br>')}</li>`)
      .join('');
    html.push(`<${listType}${attrs}>${items}</${listType}>`);
    listType = null;
    listStart = 1;
    listItems = [];
  };

  for (const line of normalized.split('\n')) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = /^\s{0,3}[-*+•]\s+(.*)$/.exec(line);
    const numbered = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/.exec(line);

    if (bullet) {
      flushParagraph();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(bullet[1]);
      continue;
    }

    if (numbered) {
      flushParagraph();
      const start = Number.parseInt(numbered[1], 10);
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
        listStart = start;
      }
      listItems.push(numbered[2]);
      continue;
    }

    // An indented line directly under a list item is a wrapped line of that
    // item, not a new paragraph.
    if (listType && listItems.length > 0 && /^\s{2,}\S/.test(line)) {
      listItems[listItems.length - 1] += `\n${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return html.join('');
}

/** Flattens rich note HTML into searchable, single-line plain text. */
export function textFromHtml(html: string): string {
  if (!html.trim()) return '';
  const withBreaks = html
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '$& ')
    .replace(/<br\s*\/?>/gi, ' ');
  const plain = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return decodeBasicEntities(plain).replace(/\s+/g, ' ').trim();
}

/**
 * Converts note HTML to clipboard-friendly plain text while keeping paragraph
 * and line breaks. Unlike `textFromHtml`, this is not meant for search.
 */
export function textFromHtmlWithBreaks(html: string): string {
  if (!html.trim()) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  const plain = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return decodeBasicEntities(plain)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

/**
 * Clipboard serializer for Ctrl+C inside the editor. Unlike
 * `textFromHtmlWithBreaks`, blocks keep a blank line between them, table cells
 * are tab-separated, and list items keep their bullet or number with nesting
 * indented, so copied prose reads naturally and never exposes Markdown syntax
 * such as `**`, `##`, or `-`.
 */
export function textFromHtmlForCopy(html: string): string {
  if (!html.trim()) return '';
  const withImages = html
    // Keep the image description instead of dropping the whole node.
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
      return alt.trim() ? ` ${alt.trim()} ` : '';
    });
  // Table cells become tab-separated values. Their inner block markup is
  // flattened first so a cell never splits its row into extra lines.
  const withCells = withImages
    .replace(
      /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi,
      (_match, _tag: string, cell: string) =>
        `${cell.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\t`,
    )
    .replace(/<\/(td|th)>/gi, '\t');
  // Lists keep their own counters: ordered items stay numbered, nested items
  // stay indented, and nothing turns into a Markdown `-` marker.
  const lists: { ordered: boolean; next: number }[] = [];
  const withLists = withCells.replace(
    /<(\/?)(ul|ol|li)\b([^>]*)>/gi,
    (_match, closing: string, tag: string, attributes: string) => {
      const name = tag.toLowerCase();
      if (name === 'li') {
        if (closing) return '\n';
        const parent = lists[lists.length - 1];
        const marker = parent?.ordered ? `${parent.next++}. ` : '• ';
        return `${'\t'.repeat(Math.max(0, lists.length - 1))}${marker}`;
      }
      if (closing) {
        lists.pop();
        return '\n';
      }
      const start = /\bstart\s*=\s*"?(\d+)/i.exec(attributes)?.[1];
      lists.push({ ordered: name === 'ol', next: Number(start) || 1 });
      return '';
    },
  );
  const withBreaks = withLists
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|blockquote|pre|table)>/gi, '\n\n');
  const plain = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });
  const lines = decodeBasicEntities(plain)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n');
  // A list item's inner paragraph adds a blank line before the next item.
  // Drop it so a list stays one block, while paragraphs keep their blank line.
  const isListItem = (line: string | undefined) =>
    Boolean(line && /^\s*(?:•|\d+\.)\s/.test(line));
  return lines
    .filter(
      (line, index) =>
        line.trim() !== '' ||
        !(isListItem(lines[index - 1]) && isListItem(lines[index + 1])),
    )
    .join('\n')
    .trim();
}

/** Appends a new rich-text passage to existing note HTML. */
export function appendHtml(existingHtml: string, additionHtml: string): string {
  const left = existingHtml.trim();
  const right = additionHtml.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}${right}`;
}

/**
 * HTML-to-Markdown conversion for the stored note source and for clipboard
 * copies. Turndown keeps the GFM structures ClipCanvas stores (tables, task
 * lists, strikethrough), and the custom rules preserve the things it does not
 * know about: local attachments, highlights, underline, and task items.
 *
 * Two services share those rules: storage escapes literal Markdown characters
 * so typed `*` stays literal on reopen, while copying leaves prose alone.
 */
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
    // line after every <br>, which is the extra vertical spacing seen after a
    // ChatGPT selection paste.
    br: '  ',
  });
  service.use(gfm);
  service.addRule('clipcanvasTableCell', {
    // TipTap wraps cell text in paragraphs, which makes the GFM cell rule emit
    // line breaks inside the pipe row. Flatten to a single line and escape
    // pipes so the table keeps its shape.
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const parent = node.parentNode as Element | null;
      const index = parent ? Array.prototype.indexOf.call(parent.childNodes, node) : 0;
      const text = content
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
      return `${index === 0 ? '| ' : ' '}${text} |`;
    },
  });
  service.addRule('clipcanvasCodeBlock', {
    // Code copied from ChatGPT and many documentation sites wraps the code in
    // divs/spans inside <pre> instead of using <pre><code>. Turndown's built-in
    // fenced rule requires a CODE child, so those blocks arrived as plain text.
    filter: 'pre',
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const code = element.querySelector('code') ?? element;
      const className = `${element.getAttribute('class') ?? ''} ${
        code.getAttribute('class') ?? ''
      }`;
      const language = /(?:^|\s)language-([\w+#.-]+)/.exec(className)?.[1] ?? '';
      // Block wrappers inside <pre> (ChatGPT uses <div><span>) have no newline
      // in textContent, so adjacent lines would merge. Rebuild the line breaks
      // from the markup instead.
      const raw = decodeBasicEntities(
        (code.innerHTML ?? '')
          // A <br> just before a closing block is a trailing break, not an
          // extra empty line.
          .replace(
            /<br\s*\/?>(?=(?:<\/(?:span|strong|em|b|i|u|s|del|code|a)>)*<\/(?:div|p|li|tr|h[1-6]|section|article|figure|pre)>)/gi,
            '',
          )
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(?:div|p|li|tr|h[1-6]|section|article|figure|pre)>/gi, '\n')
          .replace(/<[^>]+>/g, ''),
      )
        .replace(/\r\n?/g, '\n')
        .replace(/^\n+|\n+$/g, '');
      if (!raw.trim()) return '';
      const longestRun = Math.max(
        0,
        ...(raw.match(/`{3,}/g) ?? []).map((run) => run.length),
      );
      const fence = '`'.repeat(Math.max(3, longestRun + 1));
      return `\n\n${fence}${language}\n${raw}\n${fence}\n\n`;
    },
  });
  service.addRule('clipcanvasListItemParagraph', {
    // ChatGPT wraps each list item in a paragraph. Turndown then emits a blank
    // line between items (a "loose" list), which is the extra spacing users see
    // after a Ctrl+C paste. Unwrap the paragraph when it is the only content.
    filter: (node) => {
      if (node.nodeName !== 'P') return false;
      const parent = node.parentNode as Element | null;
      return parent?.nodeName === 'LI' && parent.children.length === 1;
    },
    replacement: (content) => content.trim(),
  });
  service.addRule('clipcanvasStrikethrough', {
    // turndown-plugin-gfm emits single tildes; Markdown renderers expect `~~`.
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => (content.trim() ? `~~${content}~~` : ''),
  });
  service.addRule('clipcanvasHighlight', {
    filter: ['mark'],
    replacement: (content) => (content.trim() ? `<mark>${content}</mark>` : ''),
  });
  service.addRule('clipcanvasUnderline', {
    filter: ['u'],
    replacement: (content) => (content.trim() ? `<u>${content}</u>` : ''),
  });
  service.addRule('clipcanvasAttachment', {
    filter: (node) =>
      node.nodeName === 'IMG' &&
      Boolean((node as HTMLElement).getAttribute?.('data-attachment-id')),
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const id = element.getAttribute('data-attachment-id') ?? '';
      const alt = (element.getAttribute('alt') || 'image').replace(/([[\]])/g, '\\$1');
      return `![${alt}](attachment://${id})`;
    },
  });
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

/**
 * Normalizes whitespace in converted Markdown without touching fenced code,
 * where trailing spaces and consecutive blank lines are meaningful.
 */
function tidyMarkdown(value: string): string {
  const lines: string[] = [];
  let fence: string | null = null;
  let blankLines = 0;

  for (const line of value.split('\n')) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      lines.push(line);
      blankLines = 0;
      continue;
    }
    if (fence) {
      lines.push(line);
      continue;
    }
    if (!line.trim()) {
      blankLines += 1;
      if (blankLines === 1) lines.push('');
      continue;
    }
    blankLines = 0;
    // Trim trailing indentation, but keep Markdown's two-space hard break.
    lines.push(line.replace(/[ \t]+$/, (match) => (match === '  ' ? match : '')));
  }

  return lines
    .join('\n')
    // A hard break at the end of a paragraph is redundant before the blank line
    // that already separates blocks.
    .replace(/ {2}\n\n/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();
}

/**
 * TipTap renders tables with a `<colgroup>` before `<tbody>` and no `<thead>`.
 * turndown-plugin-gfm only recognizes a heading row when it is the first child
 * of the table (or of the first tbody), so the layout elements made it keep the
 * table as raw HTML. They carry nothing Markdown can express.
 */
function stripTableLayoutMarkup(html: string): string {
  return html
    .replace(/<colgroup\b[^>]*>[\s\S]*?<\/colgroup>/gi, '')
    .replace(/<col\b[^>]*\/?>/gi, '');
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  let value: string;
  try {
    value = getStorageTurndown().turndown(stripTableLayoutMarkup(html));
  } catch {
    // A malformed fragment must never break saving an edit.
    value = decodeBasicEntities(html.replace(/<[^>]+>/g, ' '));
  }
  return tidyMarkdown(value);
}

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

/**
 * True when the Markdown source contains HTML the note schema cannot represent.
 * Those elements are already stripped before rendering, but a WYSIWYG edit would
 * drop them from the stored source too. Used to warn once, so the archive is not
 * the only record that something was preserved.
 */
export function hasUnsupportedMarkup(markdown: string): boolean {
  if (!markdown.trim() || !/<[a-z]/i.test(markdown)) return false;
  const allowed = new Set<string>(NOTE_TAGS);
  // Require a real tag shape (name followed by whitespace, `/`, or `>`), so
  // Markdown autolinks such as `<https://example.com>` are not mistaken for tags.
  for (const match of markdown.matchAll(/<\/?([a-z][a-z0-9-]*)(?:\s[^>]*)?\s*\/?>/gi)) {
    if (!allowed.has(match[1].toLowerCase())) return true;
  }
  return false;
}
