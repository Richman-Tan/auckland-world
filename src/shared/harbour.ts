/**
 * Marinas: where boats are moored along a pier. Pure (no DOM, no three, no node), so the pipeline
 * can use it and the tests can hold it to account.
 *
 * OpenStreetMap draws a marina pier as its outline: a long walkway with a comb of fingers down one
 * or both sides. A finger shows in that outline as a short edge (its tip) between two long edges
 * running back the other way. A boat lies along each side of each finger, so every finger found
 * gives two berths. Whether a berth is real water, and clear of the next boat, is for the caller to
 * check (the pipeline knows where the sea is); this only says where berths would be.
 */
import type { Berth } from './mapFormat';

export const BERTH = {
  /** A finger's tip is between these wide, metres. */
  tipMin: 0.5,
  tipMax: 3.6,
  /** Its sides are at least this long, and run back within this of parallel (cosine). */
  sideMin: 5,
  parallel: 0.9,
  /** A boat is this much of its finger's length, within these limits, and this much of its length wide. */
  share: 0.86,
  lengthMin: 6,
  lengthMax: 18,
  beam: 0.3,
  /** Water left between a boat and its finger. */
  gap: 0.45,
} as const;

/** A boat's half width for its length. */
export const boatHalfBeam = (length: number) => (length * BERTH.beam) / 2;

/** 0..1 from two numbers, the same every time. */
function pick(a: number, b: number): number {
  let h = (Math.imul(Math.round(a * 4), 0x9e3779b1) ^ Math.imul(Math.round(b * 4), 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** The two berths either side of a finger whose tip is centred on (mx, mz), running back along (-dx, -dz) for `length`, `width` wide. */
function besideFinger(mx: number, mz: number, dx: number, dz: number, length: number, width: number): Berth[] {
  const boat = Math.min(BERTH.lengthMax, length * BERTH.share);
  if (boat < BERTH.lengthMin) return [];
  // The middle of the finger, and the direction across it.
  const cx = mx - dx * (length / 2);
  const cz = mz - dz * (length / 2);
  const px = -dz;
  const pz = dx;
  const out: Berth[] = [];
  for (const side of [-1, 1]) {
    const off = side * (width / 2 + BERTH.gap + boatHalfBeam(boat));
    const x = cx + px * off;
    const z = cz + pz * off;
    // Bow to the walkway or bow out, as the owner left it. Heading 0 is north (-z), clockwise.
    const out_ = pick(x, z) < 0.5 ? 1 : -1;
    out.push({ x, z, heading: Math.atan2(dx * out_, -dz * out_), length: boat });
  }
  return out;
}

/**
 * The berths along a pier drawn as an outline (x, z pairs, either winding, not closed). A plain
 * jetty with no fingers gives none.
 */
export function berthsFromPier(ring: ArrayLike<number>): Berth[] {
  const n = ring.length >> 1;
  if (n < 6) return [];
  const out: Berth[] = [];
  const at = (i: number): [number, number] => [ring[(((i % n) + n) % n) * 2], ring[(((i % n) + n) % n) * 2 + 1]];
  for (let i = 0; i < n; i++) {
    const [ax, az] = at(i - 1);
    const [bx, bz] = at(i);
    const [cx, cz] = at(i + 1);
    const [ex, ez] = at(i + 2);
    const tip = Math.hypot(cx - bx, cz - bz);
    if (tip < BERTH.tipMin || tip > BERTH.tipMax) continue;
    const inLen = Math.hypot(bx - ax, bz - az);
    const outLen = Math.hypot(ex - cx, ez - cz);
    if (inLen < BERTH.sideMin || outLen < BERTH.sideMin) continue;
    // The side running up to the tip and the side running back from it point opposite ways.
    const ux = (bx - ax) / inLen;
    const uz = (bz - az) / inLen;
    const vx = (ex - cx) / outLen;
    const vz = (ez - cz) / outLen;
    if (ux * vx + uz * vz > -BERTH.parallel) continue;
    // And the tip lies across them, not along: a finger, not a kink in the walkway.
    if (Math.abs(((cx - bx) * ux + (cz - bz) * uz) / tip) > 0.5) continue;
    out.push(...besideFinger((bx + cx) / 2, (bz + cz) / 2, ux, uz, Math.min(inLen, outLen), tip));
  }
  return out;
}

/** The berths either side of a finger drawn as a single line (x, z pairs), `width` wide. */
export function berthsFromLine(line: ArrayLike<number>, width: number): Berth[] {
  if (line.length !== 4) return [];
  const dx = line[2] - line[0];
  const dz = line[3] - line[1];
  const len = Math.hypot(dx, dz);
  if (len < BERTH.sideMin) return [];
  return besideFinger(line[2], line[3], dx / len, dz / len, len, width);
}

/** The four corners of a berthed boat, (x, z) pairs: bow port, bow starboard, stern starboard, stern port. */
export function berthCorners(b: Berth): number[] {
  const fx = Math.sin(b.heading);
  const fz = -Math.cos(b.heading);
  const rx = -fz;
  const rz = fx;
  const hl = b.length / 2;
  const hb = boatHalfBeam(b.length);
  return [
    b.x + fx * hl - rx * hb, b.z + fz * hl - rz * hb,
    b.x + fx * hl + rx * hb, b.z + fz * hl + rz * hb,
    b.x - fx * hl + rx * hb, b.z - fz * hl + rz * hb,
    b.x - fx * hl - rx * hb, b.z - fz * hl - rz * hb,
  ];
}

/** Whether two berthed boats would touch (their rectangles overlap), by the separating-axis test. */
export function berthsOverlap(a: Berth, b: Berth): boolean {
  if (Math.hypot(a.x - b.x, a.z - b.z) > (a.length + b.length) / 2 + 1) return false;
  const ca = berthCorners(a);
  const cb = berthCorners(b);
  for (const c of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      // Two edge directions a rectangle: its side and its end.
      const nx = c[(i * 2 + 3) % 8] - c[i * 2 + 1];
      const nz = -(c[(i * 2 + 2) % 8] - c[i * 2]);
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let k = 0; k < 8; k += 2) {
        const pa = ca[k] * nx + ca[k + 1] * nz;
        const pb = cb[k] * nx + cb[k + 1] * nz;
        a0 = Math.min(a0, pa);
        a1 = Math.max(a1, pa);
        b0 = Math.min(b0, pb);
        b1 = Math.max(b1, pb);
      }
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}
