import { describe, expect, it } from 'vitest';
import { textFromHtmlForCopy } from '../src/lib/richText';

describe('textFromHtmlForCopy', () => {
  it('keeps paragraphs and blank lines without markdown', () => {
    expect(
      textFromHtmlForCopy('<p>One <strong>bold</strong> and <em>italic</em></p><p>Two</p>'),
    ).toBe('One bold and italic\n\nTwo');
  });

  it('keeps list items together', () => {
    expect(
      textFromHtmlForCopy('<ul><li><p>a</p></li><li><p>b</p></li></ul><p>c</p>'),
    ).toBe('• a\n• b\n\nc');
  });

  it('keeps numbered and nested list structure', () => {
    expect(
      textFromHtmlForCopy(
        '<ol><li><p>one</p></li><li><p>two</p><ul><li><p>sub</p></li></ul></li></ol><p>after</p>',
      ),
    ).toBe('1. one\n2. two\n\t• sub\n\nafter');
  });

  it('keeps headings and line breaks', () => {
    expect(textFromHtmlForCopy('<h2>Title</h2><p>a<br>b</p>')).toBe('Title\n\na\nb');
  });

  it('separates table cells with tabs', () => {
    expect(
      textFromHtmlForCopy(
        '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table><p>x</p>',
      ),
    ).toBe('A\tB\n1\t2\n\nx');
  });

  it('flattens task list items', () => {
    expect(
      textFromHtmlForCopy(
        '<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>todo</p></div></li></ul>',
      ),
    ).toBe('• todo');
  });
});
