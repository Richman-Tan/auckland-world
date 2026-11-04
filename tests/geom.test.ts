import { describe, expect, it } from 'vitest';
import { ringSignedAreaNorthUp } from '../src/shared/mapFormat';
import {
  assembleRings,
  distToRing,
  douglasPeucker,
  dropCollinear,
  pointInPolygon,
  pointInRing,
  reverseRing,
  ringCentroid,
  signedArea,
  simplifyRing,
} from '../scripts/lib/geom';
import { bresenham, floodFill4, median, rng } from '../scripts/lib/raster';

const square = (s: number, x = 0, y = 0) => [x, y, x + s, y, x + s, y + s, x, y + s];

describe('area and orientation', () => {
  it('signed area is positive for counter-clockwise (y up)', () => {
    expect(signedArea(square(10))).toBeCloseTo(100);
    expect(signedArea(reverseRing(square(10)))).toBeCloseTo(-100);
  });
  it('north-up area flips sign because z points south', () => {
    // In (x, z) a ring that is CCW in (x, z) is clockwise on a north-up map.
    expect(ringSignedAreaNorthUp(square(10))).toBeCloseTo(-100);
    expect(ringSignedAreaNorthUp(reverseRing(square(10)))).toBeCloseTo(100);
  });
  it('centroid of a square', () => {
    const [cx, cy] = ringCentroid(square(10, 5, 5));
    expect(cx).toBeCloseTo(10);
    expect(cy).toBeCloseTo(10);
  });
});

describe('Douglas-Peucker', () => {
  it('drops points within epsilon and keeps endpoints', () => {
    const line = [0, 0, 1, 0.1, 2, -0.1, 3, 0, 4, 5];
    const out = douglasPeucker(line, 0.5);
    expect(out.slice(0, 2)).toEqual([0, 0]);
    expect(out.slice(-2)).toEqual([4, 5]);
    expect(out.length / 2).toBeLessThan(line.length / 2);
  });
  it('keeps a real corner', () => {
    const out = douglasPeucker([0, 0, 5, 0, 5, 5], 0.5);
    expect(out).toEqual([0, 0, 5, 0, 5, 5]);
  });
  it('simplifies a ring without losing its shape', () => {
    // Square with a redundant midpoint on each edge.
    const ring = [0, 0, 5, 0, 10, 0, 10, 5, 10, 10, 5, 10, 0, 10, 0, 5];
    const out = simplifyRing(ring, 0.1);
    expect(Math.abs(signedArea(out))).toBeCloseTo(100);
    expect(out.length / 2).toBe(4);
  });
  it('drops near-collinear vertices but never goes below 3', () => {
    const ring = [0, 0, 5, 0.05, 10, 0, 10, 10];
    const out = dropCollinear(ring, 8);
    expect(out.length / 2).toBe(3);
  });
});

describe('point in polygon', () => {
  it('handles inside, outside and holes', () => {
    const outer = square(10);
    const hole = square(2, 4, 4);
    expect(pointInRing(5, 5, outer)).toBe(true);
    expect(pointInRing(15, 5, outer)).toBe(false);
    expect(pointInPolygon(1, 1, [outer, hole])).toBe(true);
    expect(pointInPolygon(5, 5, [outer, hole])).toBe(false);
  });
  it('distance to ring edge', () => {
    expect(distToRing(5, 5, square(10))).toBeCloseTo(5);
    expect(distToRing(1, 5, square(10))).toBeCloseTo(1);
  });
});

describe('ring assembly from split ways', () => {
  it('joins four edges given in mixed order and direction into one ring', () => {
    const segs = [
      { pts: [0, 0, 10, 0] },
      { pts: [10, 10, 10, 0] }, // reversed
      { pts: [10, 10, 0, 10] },
      { pts: [0, 10, 0, 0] },
    ];
    const { rings, open } = assembleRings(segs);
    expect(open).toBe(0);
    expect(rings).toHaveLength(1);
    expect(rings[0].length / 2).toBe(4);
    expect(Math.abs(signedArea(rings[0]))).toBeCloseTo(100);
  });
  it('assembles two separate rings and reports an unclosed chain', () => {
    const a = [0, 0, 4, 0, 4, 4, 0, 0];
    const b = [10, 10, 14, 10, 14, 14, 10, 10];
    const dangling = [50, 50, 60, 60];
    const { rings, open } = assembleRings([{ pts: a }, { pts: b }, { pts: dangling }]);
    expect(rings).toHaveLength(2);
    expect(open).toBe(1);
  });
  it('joins an outer ring split across three ways', () => {
    const { rings } = assembleRings([
      { pts: [0, 0, 6, 0, 6, 6] },
      { pts: [6, 6, 0, 6] },
      { pts: [0, 6, 0, 0] },
    ]);
    expect(rings).toHaveLength(1);
    expect(Math.abs(signedArea(rings[0]))).toBeCloseTo(36);
  });
});

describe('barrier lines and flood fill', () => {
  it('Bresenham draws a connected 8-neighbour line including both ends', () => {
    const w = 8, h = 8;
    const g = new Uint8Array(w * h);
    bresenham(g, w, h, 0, 0, 7, 3, 1);
    expect(g[0]).toBe(1);
    expect(g[3 * w + 7]).toBe(1);
    expect(g.reduce((s, v) => s + v, 0)).toBe(8);
  });
  it('clips lines that leave the grid', () => {
    const g = new Uint8Array(16);
    expect(() => bresenham(g, 4, 4, -5, 1, 9, 1, 1)).not.toThrow();
    expect(g.slice(4, 8)).toEqual(new Uint8Array([1, 1, 1, 1]));
  });
  it('a closed barrier keeps the fill out; an open one lets it in', () => {
    const w = 10, h = 10;
    const closed = new Uint8Array(w * h);
    // Box from (3,3) to (7,7), drawn with diagonal-safe Bresenham lines.
    bresenham(closed, w, h, 3, 3, 7, 3, 1);
    bresenham(closed, w, h, 7, 3, 7, 7, 1);
    bresenham(closed, w, h, 7, 7, 3, 7, 1);
    bresenham(closed, w, h, 3, 7, 3, 3, 1);
    const filled = floodFill4(closed, w, h, 0, 0, 2);
    expect(filled).toBe(100 - 16 - 9); // everything except the box wall and its interior
    expect(closed[5 * w + 5]).toBe(0);
    const open = new Uint8Array(w * h);
    bresenham(open, w, h, 3, 3, 7, 3, 1);
    bresenham(open, w, h, 7, 3, 7, 7, 1);
    bresenham(open, w, h, 7, 7, 3, 7, 1);
    expect(floodFill4(open, w, h, 0, 0, 2)).toBe(100 - 13);
    expect(open[5 * w + 5]).toBe(2);
  });
  it('a diagonal barrier blocks a 4-connected fill', () => {
    const w = 6, h = 6;
    const g = new Uint8Array(w * h);
    bresenham(g, w, h, 0, 5, 5, 0, 1);
    const n = floodFill4(g, w, h, 0, 0, 2);
    expect(n).toBe(15);
  });
  it('refuses a seed that sits on a barrier', () => {
    const g = new Uint8Array(9);
    g[4] = 1;
    expect(() => floodFill4(g, 3, 3, 1, 1, 2)).toThrow();
  });
});

describe('small utilities', () => {
  it('median and seeded rng', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const a = rng(1), b = rng(1);
    expect(a()).toBe(b());
  });
});
