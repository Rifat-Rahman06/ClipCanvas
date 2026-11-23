/**
 * Geometry for the canvas's magnetic alignment snapping.
 *
 * Only three alignments are supported, as requested:
 * - left edge to left edge,
 * - top edge to top edge,
 * - horizontal or vertical centers.
 *
 * Distances in this module are expressed in flow units. The canvas converts
 * the screen-pixel thresholds with the current zoom before calling in, so the
 * snap zone stays the same size on screen at every zoom level.
 */

/** The element is pulled onto the alignment at this screen distance. */
export const SNAP_ACTIVATE_DISTANCE_PX = 6;
/** An active snap releases once the element is this far away again. */
export const SNAP_RELEASE_DISTANCE_PX = 10;

export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SnapAxis = 'x' | 'y';

export interface AlignmentGuide {
  /** `x` guides are vertical lines, `y` guides are horizontal lines. */
  axis: SnapAxis;
  /** Position of the line in flow coordinates. */
  position: number;
  /** Start of the line along the perpendicular axis. */
  from: number;
  /** End of the line along the perpendicular axis. */
  to: number;
}

/**
 * The alignment a drag is currently snapped to on one axis. The offset records
 * which anchor matched (0 for the leading edge, half the size for the center)
 * so the release distance can be measured against the raw pointer position.
 */
export interface AxisLock {
  position: number;
  offset: number;
}

export interface AlignmentOptions {
  /** Distance (flow units) at which the element is pulled onto the guide. */
  snapDistance: number;
  /** Distance (flow units) at which an active snap releases again. */
  releaseDistance: number;
  /** Locks returned by the previous frame, if any. */
  lockX?: AxisLock | null;
  lockY?: AxisLock | null;
}

export interface AlignmentResult {
  /** Correction to apply to the raw position. */
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
  lockX: AxisLock | null;
  lockY: AxisLock | null;
}

interface AxisCandidate {
  /** Guide position minus the moving anchor. */
  delta: number;
  position: number;
  offset: number;
  from: number;
  to: number;
}

function isValidRect(rect: SnapRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * Collects left-to-left and center-to-center (or top-to-top and center-to-center)
 * matches against every other element. Right and bottom edges are intentionally
 * absent, and edges never align with a different element's center.
 */
function collectCandidates(
  moving: SnapRect,
  others: SnapRect[],
  axis: SnapAxis,
): AxisCandidate[] {
  const isX = axis === 'x';
  const start = isX ? moving.x : moving.y;
  const size = isX ? moving.width : moving.height;
  const perpendicularStart = isX ? moving.y : moving.x;
  const perpendicularSize = isX ? moving.height : moving.width;
  const candidates: AxisCandidate[] = [];

  for (const other of others) {
    if (!isValidRect(other)) continue;
    const otherStart = isX ? other.x : other.y;
    const otherSize = isX ? other.width : other.height;
    const otherPerpendicularStart = isX ? other.y : other.x;
    const otherPerpendicularSize = isX ? other.height : other.width;
    const pairs = [
      // Leading edges.
      { offset: 0, anchor: otherStart },
      // Centers.
      { offset: size / 2, anchor: otherStart + otherSize / 2 },
    ];

    for (const { offset, anchor } of pairs) {
      candidates.push({
        delta: anchor - (start + offset),
        position: anchor,
        offset,
        from: Math.min(perpendicularStart, otherPerpendicularStart),
        to: Math.max(
          perpendicularStart + perpendicularSize,
          otherPerpendicularStart + otherPerpendicularSize,
        ),
      });
    }
  }

  // Nearest match wins. The position/offset tie-breakers keep the result stable
  // when equal-size elements align on both their edge and their center.
  candidates.sort(
    (a, b) =>
      Math.abs(a.delta) - Math.abs(b.delta) ||
      a.position - b.position ||
      a.offset - b.offset,
  );
  return candidates;
}

function resolveAxis(
  candidates: AxisCandidate[],
  axis: SnapAxis,
  origin: number,
  options: AlignmentOptions,
  lock: AxisLock | null,
): { delta: number; guide: AlignmentGuide | null; lock: AxisLock | null } {
  const toGuide = (candidate: AxisCandidate): AlignmentGuide => ({
    axis,
    position: candidate.position,
    from: candidate.from,
    to: candidate.to,
  });

  // Keep an existing snap until the raw position leaves the release zone. The
  // raw position, not the snapped one, is what React Flow reports each frame,
  // so this is also what prevents jitter at the snap boundary.
  if (lock) {
    const lockedCandidate = candidates.find(
      (candidate) =>
        candidate.position === lock.position && candidate.offset === lock.offset,
    );
    if (lockedCandidate) {
      const distance = lock.position - (origin + lock.offset);
      if (Math.abs(distance) <= options.releaseDistance) {
        return { delta: distance, guide: toGuide(lockedCandidate), lock };
      }
    }
  }

  const best = candidates[0];
  if (!best) return { delta: 0, guide: null, lock: null };

  if (Math.abs(best.delta) <= options.snapDistance) {
    return {
      delta: best.delta,
      guide: toGuide(best),
      lock: { position: best.position, offset: best.offset },
    };
  }
  return { delta: 0, guide: null, lock: null };
}

/**
 * Resolves the alignment correction and the guide shown while snapped for one
 * drag frame. `moving` must be the raw (unsnapped) position reported by the
 * canvas.
 */
export function findAlignmentSnap(
  moving: SnapRect,
  others: SnapRect[],
  options: AlignmentOptions,
): AlignmentResult {
  if (!isValidRect(moving) || others.length === 0) {
    return { dx: 0, dy: 0, guides: [], lockX: null, lockY: null };
  }

  const x = resolveAxis(
    collectCandidates(moving, others, 'x'),
    'x',
    moving.x,
    options,
    options.lockX ?? null,
  );
  const y = resolveAxis(
    collectCandidates(moving, others, 'y'),
    'y',
    moving.y,
    options,
    options.lockY ?? null,
  );

  const guides: AlignmentGuide[] = [];
  if (x.guide) guides.push(x.guide);
  if (y.guide) guides.push(y.guide);

  return { dx: x.delta, dy: y.delta, guides, lockX: x.lock, lockY: y.lock };
}
