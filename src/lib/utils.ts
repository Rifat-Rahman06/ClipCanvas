export function noteDisplayTitle(note: { title: string }): string {
  return note.title.trim() || 'Untitled note';
}

export function projectDisplayName(project: { name: string } | null | undefined): string {
  return project?.name?.trim() || 'Unknown project';
}

/**
 * Creates an approachable title from captured text without altering the saved
 * content itself. Prefers the first meaningful line, then a word boundary.
 */
export function titleFromSelection(text: string, fallback = ''): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return fallback.trim().slice(0, 120) || 'Captured note';

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find(Boolean);
  const candidate = (firstLine ?? collapsed).replace(/^[#>*\-–—\s]+/, '').trim();

  if (candidate.length <= 90) return candidate;
  const shortened = candidate.slice(0, 90);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${(lastSpace > 40 ? shortened.slice(0, lastSpace) : shortened).trim()}…`;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Keeps copied page formatting intact while removing only the blank lines that
 * selections often pick up at their outer edges.
 */
export function normalizeCapturedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];
  for (const [unit, seconds] of ranges) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return 'just now';
}

export function formatFileDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatFileTimestamp(date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatFileDate(date)}-${hours}${minutes}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}'’-]+/gu);
  return matches?.length ?? 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(): string {
  return crypto.randomUUID();
}

/**
 * Derives a single-line heading from note content, preferring the first
 * sentence. Used when a note is saved without an explicit title.
 */
export function titleFromContent(text: string, maxLength = 90): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const sentence = /^.*?[.!?](?=\s|$)/.exec(collapsed)?.[0] ?? collapsed;
  const cleaned = sentence
    .replace(/^[#>*\-–—\s]+/, '')
    .replace(/[*_~]/g, '')
    .trim();
  return truncate(cleaned, maxLength);
}

export function textFromMarkdown(markdown: string): string {
  const parts: string[] = [];
  let inTable = false;

  for (const line of markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      inTable = false;
      continue;
    }
    // Drop thematic breaks and table alignment rows such as "| :--- | ---: |".
    if (/^([-*_]){3,}$/.test(trimmed)) {
      inTable = false;
      continue;
    }
    if (trimmed.includes('|') && /^\|?[\s:|-]+\|?$/.test(trimmed)) continue;

    const content = trimmed
      .replace(/^>\s*/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '');

    if (content.includes('|')) {
      const cells = content
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (cells.length > 1) {
        const row = cells.length === 2 ? cells.join(': ') : cells.join(' · ');
        if (inTable) parts[parts.length - 1] = `${parts[parts.length - 1]} · ${row}`;
        else parts.push(row);
        inTable = true;
        continue;
      }
    }

    inTable = false;
    parts.push(content);
  }

  return parts
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
