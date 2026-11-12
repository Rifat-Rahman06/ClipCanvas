const SKIPPED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'option',
  'button',
]);

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'div',
  'dl',
  'dd',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
  'blockquote',
]);

const LIST_TAGS = new Set(['ul', 'ol']);

function tagOf(node: Node): string {
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element).tagName.toLocaleLowerCase('en-US')
    : '';
}

function isBlock(node: Node): boolean {
  return BLOCK_TAGS.has(tagOf(node));
}

function isList(node: Node): boolean {
  return LIST_TAGS.has(tagOf(node));
}

function collapseText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}

function block(content: string): string {
  const value = content.replace(/^\n+/, '').replace(/\n+$/, '');
  return value.trim() ? `${value}\n\n` : '';
}

function wrapInline(content: string, marker: string): string {
  const leading = /^\s*/.exec(content)?.[0] ?? '';
  const trailing = /\s*$/.exec(content)?.[0] ?? '';
  const core = content.slice(
    leading.length,
    Math.max(leading.length, content.length - trailing.length),
  );
  return core ? `${leading}${marker}${core}${marker}${trailing}` : content;
}

function maxRun(value: string, character: string): number {
  let longest = 0;
  let current = 0;
  for (const item of value) {
    if (item === character) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function inlineCode(value: string): string {
  if (!value) return '';
  const ticks = '`'.repeat(Math.max(1, maxRun(value, '`') + 1));
  const padding = /(^`|`$|^\s|\s$)/.test(value) ? ' ' : '';
  return `${ticks}${padding}${value}${padding}${ticks}`;
}

function previousContentNode(children: Node[], index: number): Node | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const node = children[cursor];
    if (node.nodeType === Node.TEXT_NODE && !(node.nodeValue ?? '').trim()) continue;
    return node;
  }
  return null;
}

function nextContentNode(children: Node[], index: number): Node | null {
  for (let cursor = index + 1; cursor < children.length; cursor += 1) {
    const node = children[cursor];
    if (node.nodeType === Node.TEXT_NODE && !(node.nodeValue ?? '').trim()) continue;
    return node;
  }
  return null;
}

function renderChildren(parent: Node): string {
  const children = Array.from(parent.childNodes);
  return children
    .map((child, index) => {
      if (child.nodeType !== Node.TEXT_NODE) return renderNode(child);
      const value = child.nodeValue ?? '';
      if (!value) return '';
      if (value.trim()) return collapseText(value);
      const previous = previousContentNode(children, index);
      const next = nextContentNode(children, index);
      if (!previous || !next || isBlock(previous) || isBlock(next)) return '';
      return ' ';
    })
    .join('');
}

function renderPre(element: Element): string {
  const code = element.querySelector('code') ?? element;
  const language =
    /(?:^|\s)(?:language|lang)-([\w-]+)/.exec(code.className)?.[1] ??
    /(?:^|\s)(?:language|lang)-([\w-]+)/.exec(element.className)?.[1] ??
    '';
  const raw = (code.textContent ?? '').replace(/\n$/, '');
  const fence = '`'.repeat(Math.max(3, maxRun(raw, '`') + 1));
  return block(`${fence}${language}\n${raw}\n${fence}`);
}

function renderList(element: Element, depth = 0): string {
  const ordered = tagOf(element) === 'ol';
  const start = Number.parseInt(element.getAttribute('start') ?? '', 10);
  const firstNumber = Number.isFinite(start) ? start : 1;
  const items = Array.from(element.children).filter((child) => tagOf(child) === 'li');
  const lines: string[] = [];
  const indent = '  '.repeat(depth);

  items.forEach((item, index) => {
    const nestedLists = Array.from(item.children).filter(isList);
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    const content = Array.from(item.childNodes)
      .filter((child) => !isList(child))
      .map(renderNode)
      .join('')
      .trim();
    const task = checkbox ? `[${checkbox.checked ? 'x' : ' '}] ` : '';
    const marker = ordered ? `${firstNumber + index}. ` : '- ';
    const contentLines = (content || '').split('\n');
    const firstLine = contentLines.shift() ?? '';
    lines.push(`${indent}${marker}${task}${firstLine}`.trimEnd());
    for (const line of contentLines) {
      lines.push(`${indent}  ${line}`.trimEnd());
    }
    for (const nested of nestedLists) {
      lines.push(renderList(nested, depth + 1).replace(/\n+$/, ''));
    }
  });

  return block(lines.join('\n'));
}

function renderTable(element: Element): string {
  const rows = Array.from(element.querySelectorAll('tr'));
  if (rows.length === 0) return '';
  const matrix = rows.map((row) =>
    Array.from(row.children)
      .filter((cell) => ['td', 'th'].includes(tagOf(cell)))
      .map((cell) =>
        renderChildren(cell)
          .trim()
          .replace(/\n+/g, '<br>')
          .replace(/\|/g, '\\|'),
      ),
  );
  const width = Math.max(...matrix.map((row) => row.length));
  if (width === 0) return '';
  const normalized = matrix.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ''),
  ]);
  const header = normalized[0];
  const separator = header.map(() => '---');
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  return block(lines.join('\n'));
}

function renderNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return collapseText(node.nodeValue ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as Element;
  const tag = tagOf(element);
  if (SKIPPED_TAGS.has(tag)) return '';

  switch (tag) {
    case 'br':
      return '\n';
    case 'hr':
      return block('---');
    case 'strong':
    case 'b':
      return wrapInline(renderChildren(element), '**');
    case 'em':
    case 'i':
      return wrapInline(renderChildren(element), '*');
    case 'del':
    case 's':
    case 'strike':
      return wrapInline(renderChildren(element), '~~');
    case 'code':
      return inlineCode(element.textContent ?? '');
    case 'pre':
      return renderPre(element);
    case 'a':
      return renderChildren(element);
    case 'img':
      return element.getAttribute('alt')?.trim() ?? '';
    case 'ul':
    case 'ol':
      return renderList(element);
    case 'table':
      return renderTable(element);
    case 'blockquote': {
      const content = renderChildren(element).trim();
      if (!content) return '';
      return block(
        content
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n'),
      );
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const content = renderChildren(element).trim().replace(/\s*\n+\s*/g, ' ');
      if (!content) return '';
      const level = Number.parseInt(tag.slice(1), 10);
      return block(`${'#'.repeat(level)} ${content}`);
    }
    default:
      return isBlock(element) ? block(renderChildren(element)) : renderChildren(element);
  }
}

/**
 * Converts a copied page selection into Markdown so block structure and basic
 * emphasis survive the trip into the notebook. Anchors deliberately keep only
 * their visible text; ClipCanvas does not attach source links.
 */
export function selectionToMarkdown(selection: Selection): string {
  if (selection.rangeCount === 0 || selection.isCollapsed) return '';
  const container = document.createElement('div');
  container.appendChild(selection.getRangeAt(0).cloneContents());
  return renderChildren(container).replace(/^\n+/, '').replace(/\n+$/, '');
}
