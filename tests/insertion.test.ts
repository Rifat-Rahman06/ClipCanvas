import { describe, expect, it } from 'vitest';
import { planCapturedInsertion } from '../src/lib/insertion';

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
