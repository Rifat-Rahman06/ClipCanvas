import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

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
] as const;

const NOTE_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'data-attachment-id'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
};

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
 * the HTML. The preview honors them through `white-space: pre-wrap`, but
 * ProseMirror collapses them to spaces, so the same note looked different in
 * read and edit mode. Canonicalizing to `<br>` keeps both renderers identical.
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

/** Sanitizes rich note HTML while preserving the nodes used by the editor. */
export function sanitizeNoteHtml(html: string): string {
  if (!html.trim()) return '';
  return sanitizeHtml(preserveTextLineBreaks(html), {
    allowedTags: [...NOTE_TAGS],
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

/** Converts Markdown (the canonical note source) into editor HTML. */
export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return '';
  try {
    const rendered = marked.parse(restoreAttachmentImages(markdown), {
      async: false,
      gfm: true,
      breaks: true,
    }) as string;
    return sanitizeNoteHtml(rendered);
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
  /<(table|thead|tbody|tr|td|th|ul|ol|li|pre|blockquote|h[1-6]|hr|dl|figure)\b/i;

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
  return looksLikeMarkdown(text);
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
 * ordinary page selections. Literal prose stays literal.
 */
export function clipboardToNote({ html, text }: ClipboardPayload): NoteClipboardContent {
  const plain = normalizeClipboardText(text ?? '');
  const rich = html?.trim() ? sanitizeNoteHtml(html) : '';

  if (plain && looksLikeBlockMarkdown(plain)) {
    return { markdown: plain, html: markdownToHtml(plain) };
  }
  if (rich) {
    return { markdown: htmlToMarkdown(rich), html: rich };
  }
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

/** Appends a new rich-text passage to existing note HTML. */
export function appendHtml(existingHtml: string, additionHtml: string): string {
  const left = existingHtml.trim();
  const right = additionHtml.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}${right}`;
}

/**
 * HTML-to-Markdown conversion used by the editable Markdown source and the
 * "copy as Markdown" affordance. Turndown keeps the GFM structures ClipCanvas
 * stores (tables, task lists, strikethrough), and the custom rules preserve the
 * two things it does not know about: local attachments and highlights.
 */
let turndownService: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndownService) return turndownService;
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    br: '  \n',
  });
  service.use(gfm);
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
  turndownService = service;
  return service;
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  let value: string;
  try {
    value = getTurndown().turndown(html);
  } catch {
    // A malformed fragment must never break saving an edit.
    value = decodeBasicEntities(html.replace(/<[^>]+>/g, ' '));
  }
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();
}
