import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

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
      return part.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
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

/** Converts the Markdown stored by older versions into editor HTML. */
export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return '';
  try {
    const rendered = marked.parse(markdown, {
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
 * A conservative HTML-to-Markdown conversion used by the "copy as Markdown"
 * affordance. It intentionally handles the common note structure only.
 */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  let value = html
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_match, body: string) => {
      return `\n\`\`\`\n${decodeBasicEntities(body)}\n\`\`\`\n\n`;
    })
    .replace(/<img[^>]*data-attachment-id="([^"]+)"[^>]*>/gi, (match, id: string) => {
      const alt = /alt="([^"]*)"/i.exec(match)?.[1] || 'image';
      return `![${alt}](attachment://${id})`;
    })
    .replace(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"[^>]*>/gi, '![$1]($2)')
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<(s|del)[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, body: string) => {
      return `\n${'#'.repeat(Number(level))} ${stripInline(body)}\n\n`;
    })
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, body: string) => {
      return `\n${stripInline(body)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, body: string) => `- ${stripInline(body)}\n`)
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_match, body: string) => `${body}\n\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n---\n\n')
    .replace(/<[^>]+>/g, '');
  value = decodeBasicEntities(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return value ? `${value}\n` : '';
}

function stripInline(html: string): string {
  return decodeBasicEntities(html.replace(/<[^>]+>/g, '')).trim();
}
