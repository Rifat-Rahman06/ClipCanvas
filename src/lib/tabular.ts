/**
 * Detection and conversion for tab-separated clipboard data.
 *
 * Chrome puts a copied spreadsheet or page table on the clipboard as tabs
 * between columns and newlines between rows. Some sources also send a rich
 * flavour that puts every cell in its own block element, which flattens into one
 * paragraph per cell. The tab-separated text is the more faithful record of the
 * grid, so both the paste converter and the context-menu capture prefer it when
 * the markup did not produce a real table.
 */

/** True when plain text is a table whose columns are separated by tabs. */
export function isTabularText(value: string): boolean {
  const lines = value.split('\n').filter((line) => line.trim());
  if (lines.length < 2) return false;
  // Tab-indented code has a leading tab on every line; a table never does.
  if (lines.some((line) => line.startsWith('\t'))) return false;
  const columnCount = lines[0].split('\t').length;
  if (columnCount < 2) return false;
  let cells = 0;
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length !== columnCount) return false;
    for (const part of parts) {
      if (!part.trim() || part.length > 300) return false;
      cells += 1;
    }
  }
  return cells >= 4;
}

/** Builds a GFM table from tab-separated text; the first row is the header. */
export function tabularTextToMarkdown(value: string): string {
  const rows = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .split('\t')
        .map((cell) => cell.trim().replace(/\|/g, '\\|') || ' '),
    );
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const header = rows[0];
  const border = `| ${header.map(() => '---').join(' | ')} |`;
  return [row(header), border, ...rows.slice(1).map(row)].join('\n');
}
