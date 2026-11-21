import type { Note } from '../../types';

const DEFAULT_WIDTH = 430;
const DEFAULT_HEIGHT = 340;
const DEFAULT_GAP = 48;
const ORIGIN = { x: 48, y: 72 };
const MAX_HORIZONTAL_STEPS = 1000;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementPoint {
  x: number;
  y: number;
}

export interface PlacementInput {
  notes: Note[];
  /** Rendered width for unlocked notes (the current default note width). */
  width: number;
  height?: number;
  /** Usually the saved canvas viewport. Falls back to the newest note, then the origin. */
  reference?: PlacementPoint;
  gap?: number;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveRect(note: Note, defaultWidth: number): Rect | null {
  const layout = note.layout;
  if (!layout) return null;
  const widthLocked = layout.widthLocked ?? layout.heightLocked ?? false;
  return {
    x: finite(layout.x, ORIGIN.x),
    y: finite(layout.y, ORIGIN.y),
    width: Math.max(1, widthLocked ? finite(layout.width, defaultWidth) : defaultWidth),
    height: Math.max(1, finite(layout.height, DEFAULT_HEIGHT)),
  };
}

function pointToRectDistance(point: PlacementPoint, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, point.x - (rect.x + rect.width), 0);
  const dy = Math.max(rect.y - point.y, point.y - (rect.y + rect.height), 0);
  return Math.hypot(dx, dy);
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

function resolveReference(
  entries: Array<{ rect: Rect; updatedAt: string }>,
  reference: PlacementPoint | undefined,
): PlacementPoint {
  // The persisted viewport is a translate, not a center, and a default (0,0)
  // usually means the canvas has never been panned. Fall back to the most
  // recently touched note so placement follows the active area.
  if (
    reference &&
    Number.isFinite(reference.x) &&
    Number.isFinite(reference.y) &&
    (reference.x !== 0 || reference.y !== 0)
  ) {
    return { x: reference.x, y: reference.y };
  }
  let latest: { rect: Rect; updatedAt: string } | undefined;
  for (const entry of entries) {
    if (!latest || entry.updatedAt > latest.updatedAt) latest = entry;
  }
  if (!latest) return ORIGIN;
  return {
    x: latest.rect.x + latest.rect.width / 2,
    y: latest.rect.y + latest.rect.height / 2,
  };
}

function nearestRect(rects: Rect[], point: PlacementPoint): Rect {
  let nearest = rects[0];
  let nearestDistance = pointToRectDistance(point, nearest);
  for (let i = 1; i < rects.length; i += 1) {
    const distance = pointToRectDistance(point, rects[i]);
    if (distance < nearestDistance) {
      nearest = rects[i];
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Scans one row from the anchor in a single direction, jumping past any
 * blocking note until a free slot is found. The row keeps the anchor's top.
 */
function scanRow(
  rects: Rect[],
  anchor: Rect,
  width: number,
  height: number,
  gap: number,
  direction: 1 | -1,
): PlacementPoint | null {
  let x = direction > 0 ? anchor.x + anchor.width + gap : anchor.x - width - gap;
  for (let step = 0; step < MAX_HORIZONTAL_STEPS; step += 1) {
    const candidate: Rect = { x, y: anchor.y, width, height };
    let nextX = direction > 0 ? -Infinity : Infinity;
    let blocked = false;
    for (const rect of rects) {
      if (!overlaps(candidate, rect, gap)) continue;
      blocked = true;
      nextX =
        direction > 0
          ? Math.max(nextX, rect.x + rect.width + gap)
          : Math.min(nextX, rect.x - width - gap);
    }
    if (!blocked) return { x: Math.round(x), y: Math.round(anchor.y) };
    x = nextX;
  }
  return null;
}

/**
 * Horizontal-only placement. Keeps the new note on the anchor's row: tries
 * the right side first, then the left, then the far right of the canvas.
 */
export function findNotePlacement(input: PlacementInput): PlacementPoint {
  const width = Math.max(1, finite(input.width, DEFAULT_WIDTH));
  const height = Math.max(1, finite(input.height, DEFAULT_HEIGHT));
  const gap = Math.max(0, finite(input.gap, DEFAULT_GAP));

  const entries = input.notes.flatMap((note) => {
    const rect = resolveRect(note, width);
    return rect ? [{ rect, updatedAt: note.updatedAt ?? '' }] : [];
  });
  const rects = entries.map((entry) => entry.rect);
  if (rects.length === 0) return { ...ORIGIN };

  const reference = resolveReference(entries, input.reference);
  const anchor = nearestRect(rects, reference);

  const right = scanRow(rects, anchor, width, height, gap, 1);
  if (right) return right;
  const left = scanRow(rects, anchor, width, height, gap, -1);
  if (left) return left;

  let maxRight = -Infinity;
  for (const rect of rects) {
    maxRight = Math.max(maxRight, rect.x + rect.width);
  }
  return {
    x: Math.round(Number.isFinite(maxRight) ? maxRight + gap : ORIGIN.x),
    y: Math.round(anchor.y),
  };
}
