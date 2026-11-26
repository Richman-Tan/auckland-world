/**
 * What stands on top of a building: a pitched roof on a house, a plant room on a tower. Pure (no
 * DOM, no three), because two things must agree on it: the mesh that is drawn (world/extrude.ts)
 * and the grid the plane collides with (collision.ts).
 *
 * The map gives every building a footprint, a base and a top, and nothing about its roof. Houses
 * here have hip and gable roofs, so one is worked out for any low building whose footprint is close
 * to a rectangle: the ridge runs along the long side at the building's recorded top, and the walls
 * stop lower, at the eaves. Nothing is ever taller than the map says, so collision stays right
 * without knowing about roofs at all. Anything the rule does not fit keeps its flat roof.
 *
 * A plant room is the one thing that adds height, and collision is told (roofExtra).
 */

/** Wall kinds, by the low four bits of the style byte (scripts/lib/style.ts sets them). */
export const WALL_KIND = { glass: [0, 2], commercial: [3, 5], house: [6, 12], industrial: [13, 13] } as const;
/** Roof kinds, by the high four bits: iron and tile are pitched where the footprint allows. */
export const ROOF_PITCHED_MAX = 4;

export interface RoofPlan {
  kind: 'flat' | 'hip' | 'gable';
  /** How far the ridge stands above the eaves, metres (0 for a flat roof). */
  rise: number;
  /** The two ends of the ridge, (x, z). They coincide on a square hip roof, which comes to a point. */
  a: [number, number];
  b: [number, number];
  /** For each footprint vertex, which end of the ridge its hip or rafter runs to: 0 for a, 1 for b. */
  end: Uint8Array;
}

const FLAT: RoofPlan = { kind: 'flat', rise: 0, a: [0, 0], b: [0, 0], end: new Uint8Array(0) };

/** The limits a footprint must be inside for a pitched roof to be worked out for it. */
export const PITCHED = {
  maxVertices: 10,
  /** Shorter side of the bounding rectangle, metres. */
  minWidth: 4.5,
  maxWidth: 16,
  maxLength: 45,
  /** The footprint must fill this much of its bounding rectangle. */
  minFill: 0.82,
  /** Walls are never left shorter than this. */
  minWall: 2.3,
  /** A roof lower than this is not worth its triangles. */
  minRise: 0.9,
  /** Buildings up to this tall (base to top) can have one. */
  maxHeight: 11,
} as const;

/** A gable's ridge stops this far short of the end of the building, so its end wall leans in a hair rather than out. */
const GABLE_INSET = 0.25;

/** 0..1 from a seed and a salt, the same every time. */
export function seeded(seed: number, salt: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** A building's own number, 0 to 255, from where its first corner is: the same on every load. */
export function buildingSeed(x: number, z: number): number {
  return Math.floor(seeded(Math.round(x * 4), Math.round(z * 4)) * 256) & 255;
}

function inside(ring: ArrayLike<number>, n: number, px: number, pz: number): boolean {
  let hit = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** The smallest rectangle round a ring, trying each edge's direction: centre, long axis, half sizes, and the ring's area. */
export function boundingRectangle(ring: ArrayLike<number>): { cx: number; cz: number; ux: number; uz: number; halfLength: number; halfWidth: number; area: number } {
  const n = ring.length >> 1;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
  area = Math.abs(area) / 2;
  let best = { cx: 0, cz: 0, ux: 1, uz: 0, halfLength: 0, halfWidth: 0, area };
  let bestArea = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = ring[j * 2] - ring[i * 2];
    let uz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const len = Math.hypot(ux, uz);
    if (len < 1e-6) continue;
    ux /= len;
    uz /= len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const u = ring[k * 2] * ux + ring[k * 2 + 1] * uz;
      const v = -ring[k * 2] * uz + ring[k * 2 + 1] * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const a = (maxU - minU) * (maxV - minV);
    if (a >= bestArea) continue;
    bestArea = a;
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    const long = maxU - minU >= maxV - minV;
    best = {
      cx: cu * ux - cv * uz,
      cz: cu * uz + cv * ux,
      ux: long ? ux : -uz,
      uz: long ? uz : ux,
      halfLength: (long ? maxU - minU : maxV - minV) / 2,
      halfWidth: (long ? maxV - minV : maxU - minU) / 2,
      area,
    };
  }
  return best;
}

/**
 * The roof for a footprint (one ring, flat x, z pairs) on a building `height` tall, base to top.
 * `pitched` says whether the building is the kind that has one at all. Returns a flat roof for
 * anything the rule does not fit; that is always safe.
 */
export function roofPlan(ring: ArrayLike<number>, height: number, seed: number, pitched: boolean): RoofPlan {
  const n = ring.length >> 1;
  if (!pitched || n < 4 || n > PITCHED.maxVertices || height > PITCHED.maxHeight) return FLAT;
  const r = boundingRectangle(ring);
  const width = r.halfWidth * 2;
  const length = r.halfLength * 2;
  if (width < PITCHED.minWidth || width > PITCHED.maxWidth || length > PITCHED.maxLength) return FLAT;
  if (r.area < PITCHED.minFill * width * length) return FLAT;
  // Between 22 and 32 degrees, and never so tall that the walls under it are too short to be walls.
  const pitch = ((22 + 10 * seeded(seed, 1)) * Math.PI) / 180;
  const rise = Math.min(r.halfWidth * Math.tan(pitch), height - PITCHED.minWall);
  if (rise < PITCHED.minRise) return FLAT;
  // Nearly square: a hip roof (it comes almost to a point). Otherwise two in five are gabled, with
  // the ridge running to just inside each end wall; a footprint too crooked for that gets a hip.
  let ringArea = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) ringArea += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
  const sign = Math.sign(ringArea);
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const end = new Uint8Array(n);
  for (let i = 0; i < n; i++) end[i] = (ring[i * 2] - r.cx) * r.ux + (ring[i * 2 + 1] - r.cz) * r.uz < 0 ? 0 : 1;
  // Each end needs corners of its own, or the roof would fold over.
  let ones = 0;
  for (let i = 0; i < n; i++) ones += end[i];
  if (ones < 2 || n - ones < 2) return FLAT;

  const attempt = (kind: 'hip' | 'gable'): RoofPlan | null => {
    const reach = kind === 'gable' ? r.halfLength - GABLE_INSET : Math.max(0, r.halfLength - r.halfWidth);
    if (reach < 0) return null;
    const a: [number, number] = [r.cx - r.ux * reach, r.cz - r.uz * reach];
    const b: [number, number] = [r.cx + r.ux * reach, r.cz + r.uz * reach];
    // The ridge has to be over the building.
    for (const t of [-1, 0, 1]) if (!inside(ring, n, r.cx + r.ux * reach * t, r.cz + r.uz * reach * t)) return null;
    // Every face must face the sky (a gable's end wall may stand upright): with the footprint
    // wound one way, each face's corners, seen from above, must be wound that way too.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const xi = ring[i * 2];
      const zi = ring[i * 2 + 1];
      const xj = ring[j * 2];
      const zj = ring[j * 2 + 1];
      const ei = end[i] ? b : a;
      const ej = end[j] ? b : a;
      // (i, j, ridge end of j), and where the two corners go to different ends, (i, ridge of j, ridge of i).
      if (cross(xi, zi, xj, zj, ej[0], ej[1]) * sign < -1e-6) return null;
      if (end[i] !== end[j] && cross(xi, zi, ej[0], ej[1], ei[0], ei[1]) * sign < -1e-6) return null;
    }
    return { kind, rise, a, b, end };
  };
  const wantGable = length / width > 1.25 && seeded(seed, 2) < 0.4;
  return (wantGable ? attempt('gable') : null) ?? attempt('hip') ?? FLAT;
}

/** Whether a style byte is one of the kinds that has a pitched roof: a house or a small shop under iron or tile. */
export function pitchedStyle(style: number): boolean {
  const wall = style & 15;
  const roof = (style >> 4) & 15;
  return roof <= ROOF_PITCHED_MAX && wall >= WALL_KIND.commercial[0] && wall <= WALL_KIND.house[1];
}

/** Towers this tall, with this much roof, carry a plant room. */
export const PLANT_ROOM = { minHeight: 42, minArea: 320, minWidth: 14 } as const;

export interface PlantRoom {
  /** Its footprint: four corners, (x, z), wound like the building's ring. */
  corners: [number, number][];
  /** How far it stands above the building's top, metres. */
  height: number;
}

/**
 * The plant room on a tower's roof, or null: a box a third of the roof's size, set off-centre,
 * lined up with the building. Only for simple footprints, where the box is sure to be on the roof.
 */
export function plantRoom(ring: ArrayLike<number>, height: number, seed: number): PlantRoom | null {
  const n = ring.length >> 1;
  if (height < PLANT_ROOM.minHeight || n < 4 || n > 12) return null;
  const r = boundingRectangle(ring);
  if (r.area < PLANT_ROOM.minArea || r.halfWidth * 2 < PLANT_ROOM.minWidth || r.area < 0.75 * 4 * r.halfLength * r.halfWidth) return null;
  const hl = r.halfLength * (0.3 + 0.12 * seeded(seed, 3));
  const hw = r.halfWidth * (0.3 + 0.12 * seeded(seed, 4));
  const ou = (seeded(seed, 5) - 0.5) * r.halfLength * 0.5;
  const ov = (seeded(seed, 6) - 0.5) * r.halfWidth * 0.5;
  const vx = -r.uz;
  const vz = r.ux;
  const cx = r.cx + r.ux * ou + vx * ov;
  const cz = r.cz + r.uz * ou + vz * ov;
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => [cx + r.ux * hl * su + vx * hw * sv, cz + r.uz * hl * su + vz * hw * sv]);
  for (const [x, z] of corners) if (!inside(ring, n, x, z)) return null;
  // Wound the way the ring is.
  let ringArea = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) ringArea += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
  let own = 0;
  for (let i = 0, j = 3; i < 4; j = i++) own += corners[j][0] * corners[i][1] - corners[i][0] * corners[j][1];
  if (Math.sign(own) !== Math.sign(ringArea)) corners.reverse();
  return { corners, height: 3.6 + Math.round(seeded(seed, 7) * 5) * 0.5 };
}
