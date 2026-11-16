import { isTabularText, tabularTextToMarkdown } from '../lib/tabular';

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

/**
 * Web apps that render a table with `<div>`s still describe the grid with ARIA
 * roles. Without this the walker below emits one paragraph per cell, which is
 * exactly the "one word per line" capture the notebook used to show.
 */
const GRID_TABLE_ROLES = new Set(['table', 'grid', 'treegrid']);
const GRID_CELL_ROLES = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);

/**
 * Elements recognized as grids during the current `selectionToMarkdown` call.
 * Rendering is a plain recursive walk, so the detected matrices are collected
 * up front and consulted by `renderNode`.
 */
let gridMatrices: Map<Element, string[][]> | null = null;

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

function renderMatrix(matrix: string[][]): string {
  const width = Math.max(...matrix.map((row) => row.length));
  if (width === 0 || matrix.length === 0) return '';
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

function renderCell(cell: Element): string {
  return renderChildren(cell)
    .trim()
    .replace(/\n+/g, '<br>')
    .replace(/\|/g, '\\|');
}

function renderTable(element: Element): string {
  const rows = Array.from(element.querySelectorAll('tr'));
  if (rows.length === 0) return '';
  const matrix = rows.map((row) =>
    Array.from(row.children)
      .filter((cell) => ['td', 'th'].includes(tagOf(cell)))
      .map(renderCell),
  );
  return renderMatrix(matrix);
}

function renderNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return collapseText(node.nodeValue ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as Element;
  const tag = tagOf(element);
  if (SKIPPED_TAGS.has(tag)) return '';

  const matrix = gridMatrices?.get(element);
  if (matrix) return renderMatrix(matrix);

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
 * True when a grid cell holds a single short run of content. Multi-paragraph
 * cells, nested tables, and lists are real table content, but they are also
 * what card layouts and search results look like, so they are left alone.
 */
function isSimpleCell(cell: Element): boolean {
  const text = collapseText(cell.textContent ?? '').trim();
  if (!text || text.length > 120) return false;
  for (const descendant of Array.from(cell.querySelectorAll('*'))) {
    const tag = tagOf(descendant);
    if (SKIPPED_TAGS.has(tag) || tag === 'table' || LIST_TAGS.has(tag)) return false;
  }
  // One line of content is normal; two real paragraphs are a card, not a cell.
  return renderChildren(cell)
    .split('\n')
    .filter((line) => line.trim()).length <= 1;
}

/** Builds a matrix from `role="table"`/`grid` markup. */
function ariaMatrix(table: Element): string[][] | null {
  const rows = Array.from(table.querySelectorAll('[role="row"]')).filter((row) => {
    for (let parent = row.parentElement; parent && parent !== table; parent = parent.parentElement) {
      if (GRID_TABLE_ROLES.has((parent.getAttribute('role') ?? '').toLowerCase())) return false;
    }
    return true;
  });
  if (rows.length < 2) return null;
  const matrix = rows.map((row) => {
    const cells = Array.from(row.children).filter((child) => {
      const role = (child.getAttribute('role') ?? '').toLowerCase();
      return GRID_CELL_ROLES.has(role);
    });
    const chosen = cells.length >= 2 ? cells : Array.from(row.children);
    return chosen.map(renderCell);
  });
  const width = Math.max(...matrix.map((row) => row.length));
  if (width < 2) return null;
  return matrix;
}

/**
 * Detects an unlabeled grid: a container whose children are all rows of the
 * same number of short, single-block cells. Some editors (and many sites built
 * from `<div>`s) render tables this way without ARIA roles.
 */
function structuralMatrix(container: Element): string[][] | null {
  const rows = Array.from(container.children);
  if (rows.length < 2) return null;
  // A list of links is a list, never a table row.
  if (rows.some((row) => ['li', 'ul', 'ol'].includes(tagOf(row)))) return null;
  const width = Math.max(...rows.map((row) => row.children.length));
  if (width < 2) return null;
  if (rows.length * width < 4) return null;
  // Narrow rectangles are far too common in page layouts to guess about: two
  // columns only count when the grid is at least four rows long.
  if (width < 3 && rows.length < 4) return null;

  const last = rows.length - 1;
  const matrix: string[][] = [];
  for (const [index, row] of rows.entries()) {
    const cells = Array.from(row.children);
    // A drag can start or end mid-row, so an edge row may be narrower. The
    // missing cells are at the outer edge: left for the first row, right for
    // the last one. A narrow row in between means this is not a grid.
    if (cells.length !== width && index !== 0 && index !== last) return null;
    if (!cells.every(isSimpleCell)) return null;
    const rendered = cells.map(renderCell);
    const blanks = Array.from({ length: width - cells.length }, () => '');
    const leftPadded = index === 0 && cells.length < width;
    matrix.push(leftPadded ? [...blanks, ...rendered] : [...rendered, ...blanks]);
  }
  // Without one full row there is no way to trust the column alignment.
  if (!matrix.some((row) => row.every((cell) => cell !== ''))) return null;
  return matrix;
}

/**
 * Finds grids inside the cloned selection and records their matrices, so the
 * recursive walker can render them as Markdown tables instead of one paragraph
 * per cell.
 */
function collectGridMatrices(root: Element): Map<Element, string[][]> {
  const found = new Map<Element, string[][]>();

  const visit = (element: Element): void => {
    if (tagOf(element) === 'table') return;
    const role = (element.getAttribute('role') ?? '').toLowerCase();
    const matrix =
      GRID_TABLE_ROLES.has(role) ? ariaMatrix(element) : structuralMatrix(element);
    if (matrix) {
      found.set(element, matrix);
      return;
    }
    for (const child of Array.from(element.children)) visit(child);
  };

  visit(root);
  return found;
}

/** Wraps table rows or cells that were cloned without their `<table>` parent. */
function wrapDetachedTableParts(container: HTMLElement): void {
  const parts = Array.from(container.children).filter((child) =>
    ['TR', 'TD', 'TH', 'TBODY', 'THEAD', 'TFOOT'].includes(child.tagName),
  );
  if (parts.length === 0) return;

  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  let pendingRow: HTMLTableRowElement | null = null;

  for (const part of parts) {
    if (part.tagName === 'TR') {
      tbody.appendChild(part);
      pendingRow = null;
    } else if (part.tagName === 'TD' || part.tagName === 'TH') {
      // Consecutive cells belong to the same (cloned) row.
      if (!pendingRow) {
        pendingRow = document.createElement('tr');
        tbody.appendChild(pendingRow);
      }
      pendingRow.appendChild(part);
    } else {
      while (part.firstElementChild) tbody.appendChild(part.firstElementChild);
      part.remove();
      pendingRow = null;
    }
  }

  container.appendChild(table);
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
  // A selection that starts and ends inside one table clones only its rows (or
  // cells) without the `<table>` wrapper, which used to flatten into one
  // paragraph per cell. Rebuild the table before rendering.
  if (!container.querySelector('table')) wrapDetachedTableParts(container);
  // Div-based tables (ARIA grids and app-rendered tables without a `<table>`)
  // flatten into one paragraph per cell unless they are detected up front.
  gridMatrices = collectGridMatrices(container);
  let markdown: string;
  try {
    const rootMatrix = gridMatrices.get(container);
    markdown = (rootMatrix ? renderMatrix(rootMatrix) : renderChildren(container))
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
  } finally {
    gridMatrices = null;
  }
  // Some pages render tables as block elements instead of a real `<table>`, so
  // the walk above emits one paragraph per cell. The browser's own text copy of
  // the same selection is tab-separated, which keeps the grid.
  const plain = selection.toString().trim();
  if (isTabularText(plain) && !/(^|\n)\s*\|[^\n|]*\|/.test(markdown)) {
    return tabularTextToMarkdown(plain);
  }
  return markdown;
}
