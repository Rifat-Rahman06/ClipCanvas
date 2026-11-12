import { describe, expect, it } from 'vitest';
import {
  appendHtml,
  htmlToMarkdown,
  markdownToHtml,
  sanitizeNoteHtml,
  textFromHtml,
} from '../src/lib/richText';

describe('rich text helpers', () => {
  it('converts legacy Markdown into sanitized editor HTML', () => {
    const html = markdownToHtml(
      '# Heading\n\nA **bold** [link](https://example.com) and `code`.',
    );
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<code>code</code>');
  });

  it('removes dangerous markup and attributes from note HTML', () => {
    const html = sanitizeNoteHtml(
      '<p onclick="alert(1)">Safe<script>alert(2)</script></p>' +
        '<img data-attachment-id="attachment-1" src="javascript:alert(3)" onerror="alert(4)">',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('data-attachment-id="attachment-1"');
  });

  it('flattens rich HTML for search and snippets', () => {
    expect(textFromHtml('<p>One <strong>two</strong></p><p>Three</p>')).toBe(
      'One two Three',
    );
  });

  it('appends captured HTML without joining words', () => {
    expect(appendHtml('<p>One</p>', '<p>Two</p>')).toBe('<p>One</p><p>Two</p>');
    expect(appendHtml('', '<p>Two</p>')).toBe('<p>Two</p>');
  });

  it('converts common note HTML back to Markdown', () => {
    const markdown = htmlToMarkdown(
      '<h2>Heading</h2><p>A <strong>bold</strong> and <em>italic</em> ' +
        '<a href="https://example.com">link</a>.</p>' +
        '<ul><li>First</li><li>Second</li></ul>' +
        '<img data-attachment-id="attachment-1" alt="Chart">',
    );
    expect(markdown).toContain('## Heading');
    expect(markdown).toContain('A **bold** and *italic* [link](https://example.com).');
    expect(markdown).toContain('- First');
    expect(markdown).toContain('![Chart](attachment://attachment-1)');
  });
});
