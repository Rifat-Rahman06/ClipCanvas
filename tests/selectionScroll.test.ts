import { describe, expect, it } from 'vitest';
import {
  SELECTION_SCROLL_EDGE,
  SELECTION_SCROLL_MAX_STEP,
  selectionScrollStep,
} from '../src/lib/selectionScroll';

// A 600px tall canvas with a note that extends from -200px to 900px, so it is
// taller than the visible band in both directions.
const viewport = { viewportTop: 0, viewportBottom: 600 };
const longNote = { contentTop: -200, contentBottom: 900 };

describe('selectionScrollStep', () => {
  it('does not scroll while the pointer is away from the edges', () => {
    expect(
      selectionScrollStep({ pointerY: 300, ...viewport, ...longNote }),
    ).toBe(0);
  });

  it('scrolls down when the pointer is near the bottom edge', () => {
    const step = selectionScrollStep({ pointerY: 590, ...viewport, ...longNote });
    expect(step).toBeGreaterThan(0);
  });

  it('scrolls up when the pointer is near the top edge', () => {
    const step = selectionScrollStep({ pointerY: 10, ...viewport, ...longNote });
    expect(step).toBeLessThan(0);
  });

  it('ramps the speed up as the pointer approaches the edge', () => {
    const nearBand = selectionScrollStep({
      pointerY: viewport.viewportBottom - SELECTION_SCROLL_EDGE + 4,
      ...viewport,
      ...longNote,
    });
    const atEdge = selectionScrollStep({
      pointerY: viewport.viewportBottom,
      ...viewport,
      ...longNote,
    });
    expect(atEdge).toBeGreaterThan(nearBand);
    expect(atEdge).toBe(SELECTION_SCROLL_MAX_STEP);
  });

  it('reaches full speed beyond the edge but never exceeds the cap', () => {
    const farBelow = selectionScrollStep({
      pointerY: 5000,
      ...viewport,
      ...longNote,
    });
    expect(farBelow).toBe(SELECTION_SCROLL_MAX_STEP);
  });

  it('never scrolls when the whole note is already visible', () => {
    const shortNote = { contentTop: 120, contentBottom: 480 };
    expect(
      selectionScrollStep({ pointerY: 599, ...viewport, ...shortNote }),
    ).toBe(0);
    expect(
      selectionScrollStep({ pointerY: 1, ...viewport, ...shortNote }),
    ).toBe(0);
  });

  it('does not scroll past the note content edge', () => {
    // Only 12px of the note remain below the viewport.
    const nearlyVisible = { contentTop: 100, contentBottom: 612 };
    expect(
      selectionScrollStep({ pointerY: 600, ...viewport, ...nearlyVisible }),
    ).toBe(12);
  });

  it('clamps the edge band in a very short viewport', () => {
    const tiny = { viewportTop: 0, viewportBottom: 40 };
    const step = selectionScrollStep({
      pointerY: 40,
      ...tiny,
      contentTop: -100,
      contentBottom: 300,
    });
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(SELECTION_SCROLL_MAX_STEP);
  });

  it('ignores missing measurements', () => {
    expect(
      selectionScrollStep({
        pointerY: Number.NaN,
        ...viewport,
        ...longNote,
      }),
    ).toBe(0);
    expect(
      selectionScrollStep({
        pointerY: 600,
        viewportTop: 100,
        viewportBottom: 100,
        contentTop: 0,
        contentBottom: 500,
      }),
    ).toBe(0);
  });
});
