/** Planar geometry helpers. Rings are flat [x0, y0, x1, y1, ...] and not closed unless stated. */

/** Shoelace signed area; positive = counter-clockwise in a y-up frame. */
export function signedArea(ring: ArrayLike<number>): number {
  const n = ring.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return a / 2;
}

export function reverseRing(ring: number[]): number[] {
  const out = new Array<number>(ring.length);
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    out[i * 2] = ring[(n - 1 - i) * 2];
    out[i * 2 + 1] = ring[(n - 1 - i) * 2 + 1];
  }
  return out;
}

export function ringCentroid(ring: ArrayLike<number>): [number, number] {
  const n = ring.length / 2;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f = ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    a += f;
    cx += (ring[i * 2] + ring[j * 2]) * f;
    cy += (ring[i * 2 + 1] + ring[j * 2 + 1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += ring[i * 2]; sy += ring[i * 2 + 1]; }
    return [sx / n, sy / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function ringPerimeter(ring: ArrayLike<number>): number {
  const n = ring.length / 2;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p += Math.hypot(ring[j * 2] - ring[i * 2], ring[j * 2 + 1] - ring[i * 2 + 1]);
  }
  return p;
}

export function ringBBox(ring: ArrayLike<number>): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    if (ring[i] < x0) x0 = ring[i];
    if (ring[i] > x1) x1 = ring[i];
    if (ring[i + 1] < y0) y0 = ring[i + 1];
    if (ring[i + 1] > y1) y1 = ring[i + 1];
  }
  return [x0, y0, x1, y1];
}

/** Even-odd ray cast against one ring. */
export function pointInRing(x: number, y: number, ring: ArrayLike<number>): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2], yi = ring[i * 2 + 1], xj = ring[j * 2], yj = ring[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** rings[0] is the outer ring, the rest are holes. */
export function pointInPolygon(x: number, y: number, rings: ArrayLike<number>[]): boolean {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (pointInRing(x, y, rings[k])) return false;
  return true;
}

/** Distance from a point to a segment. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to the nearest edge of a closed ring. */
export function distToRing(px: number, py: number, ring: ArrayLike<number>): number {
  const n = ring.length / 2;
  let d = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    d = Math.min(d, distToSegment(px, py, ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]));
  }
  return d;
}

/** Douglas-Peucker on an open polyline given as a flat list. Endpoints are always kept. */
export function douglasPeucker(pts: ArrayLike<number>, eps: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return Array.from(pts);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i * 2], pts[i * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** The parts of a polyline that lie inside a rectangle, cut exactly at its edge. */
export function clipLine(line: ArrayLike<number>, minX: number, maxX: number, minZ: number, maxZ: number): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 4) runs.push(run);
    run = [];
  };
  for (let i = 0; i + 3 < line.length; i += 2) {
    const [x0, z0, x1, z1] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
    // Liang-Barsky: the stretch [t0, t1] of this segment that is inside.
    let t0 = 0;
    let t1 = 1;
    const dx = x1 - x0;
    const dz = z1 - z0;
    let inside = true;
    for (const [p, q] of [[-dx, x0 - minX], [dx, maxX - x0], [-dz, z0 - minZ], [dz, maxZ - z0]]) {
      if (p === 0) {
        if (q < 0) inside = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!inside || t0 > t1) {
      flush();
      continue;
    }
    const ax = x0 + dx * t0;
    const az = z0 + dz * t0;
    if (run.length === 0 || t0 > 0) {
      flush();
      run.push(ax, az);
    }
    run.push(x0 + dx * t1, z0 + dz * t1);
    if (t1 < 1) flush();
  }
  flush();
  return runs;
}

/** Douglas-Peucker for a closed ring: anchored at the first vertex and the vertex farthest from it. */
export function simplifyRing(ring: ArrayLike<number>, eps: number): number[] {
  const n = ring.length / 2;
  if (n <= 3) return Array.from(ring);
  let far = 1, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i * 2] - ring[0], ring[i * 2 + 1] - ring[1]);
    if (d > fd) { fd = d; far = i; }
  }
  const first: number[] = [];
  for (let i = 0; i <= far; i++) first.push(ring[i * 2], ring[i * 2 + 1]);
  const second: number[] = [];
  for (let i = far; i < n; i++) second.push(ring[i * 2], ring[i * 2 + 1]);
  second.push(ring[0], ring[1]);
  const a = douglasPeucker(first, eps);
  const b = douglasPeucker(second, eps);
  return a.concat(b.slice(2, b.length - 2));
}

/** Drop vertices where the path turns by less than `minTurnDeg` (one sweep). Keeps at least 3 vertices. */
export function dropCollinear(ring: number[], minTurnDeg: number): number[] {
  const pts: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  let i = 0;
  while (i < pts.length && pts.length > 3) {
    const n = pts.length;
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    const ax = c[0] - p[0], ay = c[1] - p[1], bx = q[0] - c[0], by = q[1] - c[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    let turn = 180;
    if (la > 0 && lb > 0) {
      const cs = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
      turn = (Math.acos(cs) * 180) / Math.PI;
    }
    if (turn < minTurnDeg) pts.splice(i, 1);
    else i++;
  }
  return pts.flat();
}

/** A segment of a way: a sequence of points (flat). Joined end-to-end by exact point equality. */
export interface Seg {
  pts: number[];
}

const key = (x: number, y: number) => `${x},${y}`;

/**
 * Join way segments end-to-end into closed rings (OSM multipolygon assembly).
 * Segments may need reversing. Returns closed rings (not repeating the first point) and the number of
 * segments left over that never closed.
 */
export function assembleRings(segs: Seg[]): { rings: number[][]; open: number } {
  const pool = segs.filter((s) => s.pts.length >= 4).map((s) => s.pts.slice());
  const rings: number[][] = [];
  let open = 0;
  const ends = new Map<string, number[]>();
  const used = new Array<boolean>(pool.length).fill(false);
  const addEnd = (k: string, i: number) => {
    const l = ends.get(k);
    if (l) l.push(i);
    else ends.set(k, [i]);
  };
  pool.forEach((p, i) => {
    addEnd(key(p[0], p[1]), i);
    addEnd(key(p[p.length - 2], p[p.length - 1]), i);
  });
  const nextAt = (k: string): number => {
    const l = ends.get(k);
    if (!l) return -1;
    for (const i of l) if (!used[i]) return i;
    return -1;
  };
  for (let s = 0; s < pool.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    let chain = pool[s].slice();
    let closed = false;
    for (;;) {
      const hx = chain[0], hy = chain[1];
      const tx = chain[chain.length - 2], ty = chain[chain.length - 1];
      if (hx === tx && hy === ty && chain.length >= 8) { closed = true; break; }
      const k = key(tx, ty);
      const i = nextAt(k);
      if (i < 0) break;
      used[i] = true;
      const p = pool[i];
      if (p[0] === tx && p[1] === ty) chain = chain.concat(p.slice(2));
      else {
        const rev = reverseRing(p);
        chain = chain.concat(rev.slice(2));
      }
    }
    if (closed) rings.push(chain.slice(0, chain.length - 2));
    else open++;
  }
  return { rings, open };
}
