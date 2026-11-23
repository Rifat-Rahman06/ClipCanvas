import { describe, expect, it } from 'vitest';
import {
  SNAP_ACTIVATE_DISTANCE_PX,
  SNAP_RELEASE_DISTANCE_PX,
  findAlignmentSnap,
  type SnapRect,
} from '../src/lib/snapping';

const options = {
  snapDistance: SNAP_ACTIVATE_DISTANCE_PX,
  releaseDistance: SNAP_RELEASE_DISTANCE_PX,
};

const other: SnapRect = { x: 100, y: 100, width: 200, height: 100 };

function moving(x: number, y: number, width = 200, height = 100): SnapRect {
  return { x, y, width, height };
}

describe('findAlignmentSnap', () => {
  it('snaps a nearby left edge and reports the guide', () => {
    const result = findAlignmentSnap(moving(105, 400), [other], options);

    expect(result.dx).toBeCloseTo(-5);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([
      { axis: 'x', position: 100, from: 100, to: 500 },
    ]);
    expect(result.lockX).toEqual({ position: 100, offset: 0 });
  });

  it('shows no guide outside the snap distance', () => {
    const result = findAlignmentSnap(moving(108, 400), [other], options);

    expect(result.dx).toBe(0);
    expect(result.guides).toEqual([]);
    expect(result.lockX).toBeNull();
  });

  it('snaps a nearby top edge', () => {
    const result = findAlignmentSnap(moving(400, 103), [other], options);

    expect(result.dy).toBeCloseTo(-3);
    expect(result.dx).toBe(0);
    expect(result.guides).toEqual([
      { axis: 'y', position: 100, from: 100, to: 600 },
    ]);
  });

  it('snaps horizontal centers', () => {
    const wideOther: SnapRect = { x: 100, y: 100, width: 300, height: 100 };
    const result = findAlignmentSnap(moving(147, 400), [wideOther], options);

    expect(result.dx).toBeCloseTo(3);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([
      { axis: 'x', position: 250, from: 100, to: 500 },
    ]);
  });

  it('snaps vertical centers', () => {
    const tallOther: SnapRect = { x: 100, y: 100, width: 200, height: 200 };
    const result = findAlignmentSnap(moving(400, 147), [tallOther], options);

    expect(result.dy).toBeCloseTo(3);
    expect(result.dx).toBe(0);
    expect(result.guides).toEqual([
      { axis: 'y', position: 200, from: 100, to: 600 },
    ]);
  });

  it('does not snap right or bottom edges', () => {
    // The moving right edge is 2px from the other's left edge, but only left,
    // top, and center anchors are supported.
    const result = findAlignmentSnap(moving(100, 400), [{ ...other, x: 298 }], options);

    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([]);
  });

  it('does not align an edge with a different element center', () => {
    // The moving left edge is 5px from the other's horizontal center, but an
    // edge only aligns with the same edge, not with a center.
    const centered: SnapRect = { x: 0, y: 100, width: 200, height: 100 };
    const result = findAlignmentSnap(moving(95, 400), [centered], options);

    expect(result.dx).toBe(0);
    expect(result.guides).toEqual([]);
  });

  it('keeps an active snap inside the release zone and releases beyond it', () => {
    const first = findAlignmentSnap(moving(105, 400), [other], options);
    expect(first.dx).toBeCloseTo(-5);
    expect(first.lockX).not.toBeNull();

    // 8px away: still snapped, because the release distance is 10px.
    const held = findAlignmentSnap(moving(108, 400), [other], {
      ...options,
      lockX: first.lockX,
    });
    expect(held.dx).toBeCloseTo(-8);
    expect(held.lockX).not.toBeNull();
    expect(held.guides).toHaveLength(1);

    // 11px away: the snap releases and the guide disappears with it.
    const released = findAlignmentSnap(moving(111, 400), [other], {
      ...options,
      lockX: held.lockX,
    });
    expect(released.dx).toBe(0);
    expect(released.lockX).toBeNull();
    expect(released.guides).toEqual([]);
  });

  it('keeps screen distances constant by scaling thresholds with zoom', () => {
    // At 2x zoom, 6/10 screen pixels are 3/5 flow units.
    const zoomed = {
      snapDistance: SNAP_ACTIVATE_DISTANCE_PX / 2,
      releaseDistance: SNAP_RELEASE_DISTANCE_PX / 2,
    };

    // 2 flow units = 4 screen px: snapped.
    expect(findAlignmentSnap(moving(102, 400), [other], zoomed).dx).toBeCloseTo(-2);

    // 4 flow units = 8 screen px: outside the snap zone, so no guide.
    const outside = findAlignmentSnap(moving(104, 400), [other], zoomed);
    expect(outside.dx).toBe(0);
    expect(outside.guides).toEqual([]);
  });

  it('aligns both axes at once', () => {
    const result = findAlignmentSnap(moving(103, 104), [other], options);

    expect(result.dx).toBeCloseTo(-3);
    expect(result.dy).toBeCloseTo(-4);
    expect(result.guides.map((guide) => guide.axis)).toEqual(['x', 'y']);
  });

  it('ignores other elements with invalid geometry', () => {
    const result = findAlignmentSnap(moving(105, 400), [
      { x: 100, y: 100, width: 0, height: 100 },
      { x: Number.NaN, y: 100, width: 200, height: 100 },
    ], options);

    expect(result.dx).toBe(0);
    expect(result.guides).toEqual([]);
  });

  it('returns no guides when there are no other elements', () => {
    const result = findAlignmentSnap(moving(105, 400), [], options);

    expect(result).toEqual({ dx: 0, dy: 0, guides: [], lockX: null, lockY: null });
  });
});
