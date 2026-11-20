/**
 * Geometry for auto-scrolling the canvas while a note's text is being
 * selected. Notes are not scroll containers: the editor grows inside the React
 * Flow viewport, so "scrolling the editor" means vertically panning the canvas
 * while the selection keeps extending.
 */

/** Height of the top/bottom band that triggers auto-scrolling, in screen px. */
export const SELECTION_SCROLL_EDGE = 56;
/** Content movement at full speed, in screen px per 60 fps frame. */
export const SELECTION_SCROLL_MAX_STEP = 22;

export interface SelectionScrollInput {
  /** Current pointer position, in client coordinates. */
  pointerY: number;
  /** Visible canvas band, in client coordinates. */
  viewportTop: number;
  viewportBottom: number;
  /** Measured box of the note's editable content, in client coordinates. */
  contentTop: number;
  contentBottom: number;
}

/**
 * Returns how far the content should move up on this frame, in screen pixels.
 * A positive value reveals content below the viewport (scrolling down), a
 * negative value reveals content above it. Zero means no scrolling: the
 * pointer is away from both edges, or the note has no content left to reveal.
 */
export function selectionScrollStep({
  pointerY,
  viewportTop,
  viewportBottom,
  contentTop,
  contentBottom,
}: SelectionScrollInput): number {
  if (
    !Number.isFinite(pointerY) ||
    !Number.isFinite(viewportTop) ||
    !Number.isFinite(viewportBottom) ||
    !Number.isFinite(contentTop) ||
    !Number.isFinite(contentBottom)
  ) {
    return 0;
  }

  const height = viewportBottom - viewportTop;
  if (height <= 0) return 0;
  // Never let the two bands overlap in a very short viewport.
  const edge = Math.min(SELECTION_SCROLL_EDGE, height / 2);
  if (edge <= 0) return 0;

  const bottomBandStart = viewportBottom - edge;
  if (pointerY >= bottomBandStart) {
    // Only scroll if the note continues past the bottom of the viewport;
    // otherwise the whole note is already visible.
    const remaining = contentBottom - viewportBottom;
    if (remaining <= 0) return 0;
    const depth = Math.min(edge, pointerY - bottomBandStart);
    // Ramp from the band's inner boundary up to full speed at the edge.
    const step = (SELECTION_SCROLL_MAX_STEP * depth) / edge;
    return Math.min(remaining, step);
  }

  const topBandEnd = viewportTop + edge;
  if (pointerY <= topBandEnd) {
    const remaining = viewportTop - contentTop;
    if (remaining <= 0) return 0;
    const depth = Math.min(edge, topBandEnd - pointerY);
    const step = (SELECTION_SCROLL_MAX_STEP * depth) / edge;
    return -Math.min(remaining, step);
  }

  return 0;
}
