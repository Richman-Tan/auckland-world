/** Small raster helpers: Bresenham barriers, flood fill, median, majority downsampling. */

/** 1-px Bresenham line into a u8 grid. Out-of-grid pixels are skipped. */
export function bresenham(grid: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, val: number) {
  let dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) grid[y0 * w + x0] = val;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  dx = 0;
}

/**
 * 4-connected flood fill. Fills cells equal to 0 with `fillVal` starting at the seed.
 * Returns the number of cells filled. The seed must be 0.
 */
export function floodFill4(grid: Uint8Array, w: number, h: number, sx: number, sy: number, fillVal: number): number {
  if (grid[sy * w + sx] !== 0) throw new Error(`floodFill4: seed (${sx},${sy}) is not an empty cell`);
  const stack = new Int32Array(w * h);
  let sp = 0;
  stack[sp++] = sy * w + sx;
  grid[sy * w + sx] = fillVal;
  let count = 1;
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0 && grid[i - 1] === 0) { grid[i - 1] = fillVal; stack[sp++] = i - 1; count++; }
    if (x < w - 1 && grid[i + 1] === 0) { grid[i + 1] = fillVal; stack[sp++] = i + 1; count++; }
    if (y > 0 && grid[i - w] === 0) { grid[i - w] = fillVal; stack[sp++] = i - w; count++; }
    if (y < h - 1 && grid[i + w] === 0) { grid[i + w] = fillVal; stack[sp++] = i + w; count++; }
  }
  return count;
}

/** Median of a numeric array (destructively sorts a copy). NaN-free input expected. */
export function median(values: ArrayLike<number>): number {
  const a = Float64Array.from(values as ArrayLike<number>).sort();
  const n = a.length;
  if (n === 0) return NaN;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap string/number hash for per-building variety. */
export function hash32(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
