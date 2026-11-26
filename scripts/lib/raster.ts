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

/**
 * Fill a polygon into a grid: every cell whose centre is inside it (even-odd, so later rings are
 * holes) is set to `value`. Rings are flat [x, y, ...] in grid units, where cell (c, r) covers
 * [c, c + 1) x [r, r + 1). Exact and unblended, unlike a canvas fill, so it can paint class codes.
 */
export function fillPolygon(grid: Uint8Array, w: number, h: number, rings: readonly ArrayLike<number>[], value: number): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 2) {
      if (ring[i] < minY) minY = ring[i];
      if (ring[i] > maxY) maxY = ring[i];
    }
  }
  const r0 = Math.max(0, Math.ceil(minY - 0.5));
  const r1 = Math.min(h - 1, Math.floor(maxY - 0.5));
  const xs: number[] = [];
  let filled = 0;
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5;
    xs.length = 0;
    for (const ring of rings) {
      const n = ring.length >> 1;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const y1 = ring[i * 2 + 1];
        const y2 = ring[j * 2 + 1];
        if (y1 > y !== y2 > y) xs.push(ring[i * 2] + ((y - y1) / (y2 - y1)) * (ring[j * 2] - ring[i * 2]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) grid[r * w + c] = value;
      if (c1 >= c0) filled += c1 - c0 + 1;
    }
  }
  return filled;
}

/** Set every cell whose centre is within `half` of a polyline (flat [x, y, ...] in grid units). */
export function stampLine(grid: Uint8Array, w: number, h: number, line: ArrayLike<number>, half: number, value: number) {
  for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2];
    const ay = line[i - 1];
    const bx = line[i];
    const by = line[i + 1];
    const c0 = Math.max(0, Math.floor(Math.min(ax, bx) - half));
    const c1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + half));
    const r0 = Math.max(0, Math.floor(Math.min(ay, by) - half));
    const r1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + half));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const px = c + 0.5 - ax;
        const py = r + 0.5 - ay;
        const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
        const ex = px - dx * t;
        const ey = py - dy * t;
        if (ex * ex + ey * ey <= half * half) grid[r * w + c] = value;
      }
    }
  }
}

/** Grow every set cell by `radius` cells in each direction (a square, done as two passes). */
export function dilate(grid: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const tmp = new Uint8Array(grid.length);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!grid[r * w + c]) continue;
      const a = Math.max(0, c - radius);
      const b = Math.min(w - 1, c + radius);
      for (let k = a; k <= b; k++) tmp[r * w + k] = 1;
    }
  }
  const out = new Uint8Array(grid.length);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!tmp[r * w + c]) continue;
      const a = Math.max(0, r - radius);
      const b = Math.min(h - 1, r + radius);
      for (let k = a; k <= b; k++) out[k * w + c] = 1;
    }
  }
  return out;
}
