import { normalizeCapturedText } from './utils';
import { markdownToHtml } from './richText';

export interface CapturedInsertion {
  /** The exact text to hand to the textarea's native insertion command. */
  inserted: string;
  /** Caret position after the captured block, before any trailing separator. */
  position: number;
}

/**
 * Converts a captured passage into editor HTML while keeping paragraph breaks,
 * lists, headings, and inline formatting, and removing only outer blank lines
 * and accidental trailing spaces.
 *
 * Page selections arrive as Markdown (`selectionToMarkdown`), so the Markdown
 * renderer is the correct converter here. The previous plain-text path wrapped
 * every line in one paragraph with `<br>`, which turned a copied bullet list
 * into a single paragraph of literal "-" characters.
 */
export function capturedTextToHtml(value: string): string {
  const normalized = normalizeCapturedText(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return markdownToHtml(normalized);
}

/**
 * Plans a captured passage insertion without adding a blank line above it.
 * A single newline is added only when the caret would otherwise join the
 * passage to existing text.
 */
export function planCapturedInsertion(
  content: string,
  caret: number,
  captured: string,
): CapturedInsertion {
  const text = normalizeCapturedText(captured);
  const safeCaret =
    Number.isFinite(caret) && caret >= 0 && caret <= content.length
      ? Math.trunc(caret)
      : content.length;
  if (!text.trim()) return { inserted: '', position: safeCaret };

  const before = content.slice(0, safeCaret);
  const after = content.slice(safeCaret);
  const leading = before.length > 0 && !/\s$/.test(before) ? '\n' : '';
  const trailing = after.length > 0 && !/^\s/.test(after) ? '\n' : '';

  return {
    inserted: `${leading}${text}${trailing}`,
    position: safeCaret + leading.length + text.length,
  };
}
