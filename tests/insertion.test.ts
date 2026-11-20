import { describe, expect, it } from 'vitest';
import {
  capturedTextToEditorInsertion,
  planCapturedInsertion,
} from '../src/lib/insertion';

describe('capturedTextToEditorInsertion', () => {
  it('exposes a single paragraph as inline content for caret insertion', () => {
    const result = capturedTextToEditorInsertion('Hello **world**');
    expect(result.inlineHtml).toBe('Hello <strong>world</strong>');
    expect(result.html).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('keeps a multi-paragraph capture as block content', () => {
    const result = capturedTextToEditorInsertion('First paragraph\n\nSecond paragraph');
    expect(result.inlineHtml).toBeNull();
    expect(result.html).toContain('<p>First paragraph</p>');
    expect(result.html).toContain('<p>Second paragraph</p>');
  });

  it('keeps list captures as block content', () => {
    const result = capturedTextToEditorInsertion('- One\n- Two');
    expect(result.inlineHtml).toBeNull();
    expect(result.html).toContain('<ul>');
  });
});

describe('planCapturedInsertion', () => {
  it('inserts a captured block without a leading blank line', () => {
    const result = planCapturedInsertion('', 0, '\n\n## Heading\n\n- One\n- Two\n\n');
    expect(result.inserted).toBe('## Heading\n\n- One\n- Two');
    expect(result.position).toBe(result.inserted.length);
  });

  it('adds only one separator when appending to existing text', () => {
    const result = planCapturedInsertion('Intro', 5, '## Heading');
    expect(result.inserted).toBe('\n## Heading');
    expect(result.position).toBe(16);
  });

  it('does not add a separator when the caret already sits on a new line', () => {
    const result = planCapturedInsertion('Intro\n\n', 7, '- One');
    expect(result.inserted).toBe('- One');
  });

  it('keeps indentation inside copied code-like text', () => {
    const result = planCapturedInsertion('Intro', 5, '  indented\n    deeper');
    expect(result.inserted).toBe('\n  indented\n    deeper');
  });
});
