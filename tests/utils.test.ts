import { describe, expect, it } from 'vitest';
import {
  normalizeCapturedText,
  textFromMarkdown,
  titleFromContent,
  titleFromSelection,
} from '../src/lib/utils';

describe('normalizeCapturedText', () => {
  it('normalizes line endings and drops only outer blank lines', () => {
    expect(normalizeCapturedText('\r\n\r\n  indented line\nnext line\r\n\r\n')).toBe(
      '  indented line\nnext line',
    );
  });
});

describe('textFromMarkdown', () => {
  it('strips headings, emphasis, links, and code blocks', () => {
    const text = textFromMarkdown(
      '# Findings\n\nSome **bold** and _italic_ text with a [link](https://example.com).\n\n```ts\nconst x = 1;\n```',
    );
    expect(text).not.toContain('#');
    expect(text).not.toContain('**');
    expect(text).not.toContain('https://example.com');
    expect(text).not.toContain('const x');
    expect(text).toContain('Findings');
    expect(text).toContain('link');
  });

  it('keeps hyphens inside words while dropping list markers and rules', () => {
    const text = textFromMarkdown('- state-of-the-art results\n\n---\n\n1. next step');
    expect(text).toBe('state-of-the-art results next step');
  });

  it('flattens table rows and drops alignment separators', () => {
    const text = textFromMarkdown(
      [
        '| Model | Score |',
        '| :--- | ---: |',
        '| Baseline | 61.2 |',
        '| Ours | 74.8 |',
      ].join('\n'),
    );
    expect(text).toBe('Model: Score · Baseline: 61.2 · Ours: 74.8');
    expect(text).not.toContain('---');
    expect(text).not.toContain('|');
  });

  it('returns a clean single line for an empty document', () => {
    expect(textFromMarkdown('\n\n   \n')).toBe('');
  });
});

describe('titleFromSelection', () => {
  it('uses the first meaningful line without Markdown markers', () => {
    expect(titleFromSelection('\n\n> A quoted opening line.\nMore text.')).toBe(
      'A quoted opening line.',
    );
  });

  it('falls back to a default title for empty selections', () => {
    expect(titleFromSelection('   ', '')).toBe('Captured note');
  });

  it('shortens long selections at a word boundary', () => {
    const title = titleFromSelection('word '.repeat(80));
    expect(title.length).toBeLessThanOrEqual(91);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('titleFromContent', () => {
  it('takes the first sentence of a note body', () => {
    expect(
      titleFromContent('Attention is a limited resource. It shapes what we remember.'),
    ).toBe('Attention is a limited resource.');
  });

  it('falls back to the whole text when no sentence ending exists', () => {
    expect(titleFromContent('Notes on spacing effects')).toBe('Notes on spacing effects');
  });

  it('strips headings and emphasis and returns an empty string for blank content', () => {
    expect(titleFromContent('## **Findings**')).toBe('Findings');
    expect(titleFromContent('  \n ')).toBe('');
  });

  it('shortens long sentences at a word boundary', () => {
    const title = titleFromContent('word '.repeat(60));
    expect(title.length).toBeLessThanOrEqual(91);
    expect(title.endsWith('…')).toBe(true);
  });
});
