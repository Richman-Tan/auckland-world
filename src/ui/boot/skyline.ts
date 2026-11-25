/**
 * The picture shown while the map loads: a blueprint of the skyline that goes up as the real load
 * progresses, with the Sky Tower as the gauge (its mast is finished when the load is). This file is
 * the geometry and the timing only, with no canvas and no DOM, so it can be tested.
 *
 * Units are the site's chunky pixels: one unit here is one pixel of the low-resolution picture.
 */

/** mulberry32: the same seed always lays out the same city. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Block {
  /** Left edge and width. */
  x: number;
  w: number;
  /** Full height above the horizon. */
  height: number;
  /** Load progress (0 to 1) at which it starts to rise, and how much progress it takes to finish. */
  start: number;
  span: number;
  /** Behind the front row: drawn first and fainter. */
  back: boolean;
  /** Picks which of its windows are lit. */
  seed: number;
}

export interface Skyline {
  width: number;
  height: number;
  /** The row the city stands on. */
  horizon: number;
  /** Where the buildings begin: clear of the title on a wide screen, the left edge on a narrow one. */
  left: number;
  blocks: Block[];
  tower: { x: number; height: number };
}

/** Progress at which the tower starts going up; it tops out at 1. */
export const TOWER_START = 0.08;

export function layoutSkyline(width: number, height: number): Skyline {
  const wide = width > height * 1.1;
  const horizon = Math.floor(height * (wide ? 0.8 : 0.88));
  const left = wide ? Math.floor(width * 0.4) : 0;
  const span = width - left;
  // Roughly where the real tower stands in the title screen's opening shot, so one gives way to the other.
  const towerX = Math.floor(left + span * (wide ? 0.4 : 0.62));
  const tower = { x: towerX, height: Math.max(24, Math.floor(horizon * (wide ? 0.72 : 0.5))) };
  const random = seeded(1840);
  const blocks: Block[] = [];
  for (const back of [true, false]) {
    let x = left + Math.floor(random() * 4);
    while (x < width) {
      const w = 5 + Math.floor(random() * (back ? 10 : 8));
      // A city centre: tallest around the tower, low at the edges.
      const d = (x + w / 2 - towerX) / (span * 0.2);
      const cbd = Math.exp(-d * d);
      const tall = (back ? 0.07 : 0.035) + cbd * (back ? 0.3 : 0.18);
      const h = Math.max(4, Math.floor(horizon * tall * (0.55 + random() * 0.7)));
      blocks.push({ x, w, height: h, start: random() * 0.7, span: 0.12 + random() * 0.14, back, seed: Math.floor(random() * 1e9) });
      x += w + (random() < 0.3 ? 1 + Math.floor(random() * 3) : 0);
    }
  }
  return { width, height, horizon, left, blocks, tower };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How tall a block stands at this much progress: whole pixels, 0 before its start, full after it. */
export function risen(b: Pick<Block, 'height' | 'start' | 'span'>, progress: number): number {
  return Math.floor(b.height * clamp01((progress - b.start) / b.span));
}

/** How tall the tower stands at this much progress; exactly its full height at 1. */
export function towerRisen(fullHeight: number, progress: number): number {
  return Math.floor(fullHeight * clamp01((progress - TOWER_START) / (1 - TOWER_START)));
}

/**
 * The tower's half-width at a height above the ground (0 at the base), for a tower `full` tall:
 * a shaft, the pod two thirds of the way up, a narrower neck, then the mast.
 */
export function towerHalfWidth(y: number, full: number): number {
  const t = y / full;
  if (t >= 0.8) return 0; // mast: one pixel
  if (t >= 0.7) return 1; // neck
  if (t >= 0.6) {
    // The pod: widest in the middle of its band.
    const k = (t - 0.6) / 0.1;
    return 2 + Math.round(2.4 * Math.sin(Math.PI * k));
  }
  return t < 0.06 ? 2 : 1; // shaft, flared at the foot
}

/** Whether a window at (col, row) of a block is lit: about one in three, fixed for a given block. */
export function windowLit(seed: number, col: number, row: number): boolean {
  let n = (seed ^ Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b)) >>> 0;
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d) >>> 0;
  n ^= n >>> 12;
  return n % 3 === 0;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** The 4x4 ordered-dither matrix: 0 to 15. */
export function bayer4(x: number, y: number): number {
  return BAYER4[((y & 3) << 2) | (x & 3)];
}

/** How ragged the edge of the reveal is: 0 is a clean circle, larger is more dither. */
const SPREAD = 0.7;

/**
 * When pixel (x, y) is cleared as the picture gives way to the live city: a value in (0, 1), earliest
 * at (cx, cy) and latest in the far corner, broken up by the dither matrix. The pixel is clear once
 * the reveal's own 0-to-1 clock has passed this value, so every pixel is solid at 0 and gone at 1.
 */
export function clearsAt(x: number, y: number, width: number, height: number, cx: number, cy: number): number {
  const far = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) || 1;
  const d = Math.hypot(x - cx, y - cy) / far;
  return (d + (SPREAD * (bayer4(x, y) + 0.5)) / 16) / (1 + SPREAD);
}
