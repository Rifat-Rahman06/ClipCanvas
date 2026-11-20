import { describe, expect, it } from 'vitest';
import { markdownToHtml, textFromHtmlForCopy } from '../src/lib/richText';

/** The options the TXT download passes; clipboard copies use the defaults. */
const TXT = {
  taskStatus: true,
  imageBlocks: true,
  tableColumns: true,
  quoteDepth: true,
} as const;

const toText = (markdown: string) => textFromHtmlForCopy(markdownToHtml(markdown), TXT);
const toClipboard = (markdown: string) => textFromHtmlForCopy(markdownToHtml(markdown));

describe('TXT export structure', () => {
  it('keeps task completion for regular and nested items', () => {
    expect(
      toText('- [x] Completed task\n- [ ] Incomplete task\n  - [x] Nested done\n  - [ ] Nested todo'),
    ).toBe(
      '• [x] Completed task\n• [ ] Incomplete task\n\t• [x] Nested done\n\t• [ ] Nested todo',
    );
  });

  it('reads task state from the editor task list markup', () => {
    const html =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Done</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Todo</p></div></li></ul>';
    expect(textFromHtmlForCopy(html, TXT)).toBe('• [x] Done\n• [ ] Todo');
  });

  it('separates an image description from following content', () => {
    expect(toText('![Sample image description](image.png)\n10. Horizontal Rule')).toBe(
      'Sample image description\n\n10. Horizontal Rule',
    );
  });

  it('separates consecutive images and the next heading', () => {
    expect(toText('![First image](a.png)\n\n![Second image](b.png)\n\n## Next heading')).toBe(
      'First image\n\nSecond image\n\nNext heading',
    );
  });

  it('keeps table rows on one tab-separated line and preserves empty cells', () => {
    expect(
      toText('| Name | Age | Country |\n|---|---|---|\n| Alex | 24 | USA |\n| Sarah |  | UK |'),
    ).toBe('Name\tAge\tCountry\nAlex\t24\tUSA\nSarah\t\tUK');
  });

  it('keeps nested blockquote levels', () => {
    expect(
      toText(
        '> First level quotation.\n>\n> > Second level quotation.\n> >\n> > > Third level quotation.',
      ),
    ).toBe('> First level quotation.\n>> Second level quotation.\n>>> Third level quotation.');
  });

  it('keeps escaped Markdown characters literal', () => {
    expect(toText('\\*Not italic\\*\n\\# Not a heading\n\\- Not a bullet')).toBe(
      '*Not italic*\n# Not a heading\n- Not a bullet',
    );
  });
});

describe('Ctrl+C output stays unchanged', () => {
  it('does not add task state', () => {
    expect(toClipboard('- [x] Completed task\n- [ ] Incomplete task')).toBe(
      '•  Completed task\n•  Incomplete task',
    );
  });

  it('keeps the existing image spacing', () => {
    expect(toClipboard('![Sample image description](image.png)\n10. Horizontal Rule')).toBe(
      'Sample image description\n10. Horizontal Rule',
    );
  });

  it('keeps the existing table handling', () => {
    expect(
      toClipboard('| Name | Age | Country |\n|---|---|---|\n| Alex | 24 | USA |\n| Sarah |  | UK |'),
    ).toBe('Name\nAge\nCountry\n\nAlex\n24\nUSA\n\nSarah\n\nUK');
  });

  it('keeps blockquotes flattened', () => {
    expect(toClipboard('> First level quotation.\n>\n> > Second level quotation.')).toBe(
      'First level quotation.\n\nSecond level quotation.',
    );
  });
});
