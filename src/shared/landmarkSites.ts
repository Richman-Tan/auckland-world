/**
 * The landmarks modelled by hand from what the map measures of them (meta.landmarks: the museum,
 * Eden Park, the Wynyard silos and footbridge, the port's cranes and its container yard). Pure, and
 * shared, so three things agree: which plain buildings are left out to make room for a model, what
 * the model is (world/landmarks/sites.ts draws from the shapes here), and what the plane can hit.
 */
import type { BuildingsData, MapMeta, SiteBox } from './mapFormat';

type Landmarks = MapMeta['landmarks'];
/** A collider as collision.ts defines it (repeated here to keep this file free of that import). */
export type SiteCollider =
  | { kind: 'cylinder'; name: string; x: number; z: number; y0: number; y1: number; r: number }
  | { kind: 'box'; name: string; cx: number; cz: number; ux: number; uz: number; hu: number; hv: number; y0: number; y1: number };

/** Whether (x, z) is inside a site's rectangle, grown by `margin`. */
export function inSiteBox(s: SiteBox, x: number, z: number, margin = 0): boolean {
  const dx = x - s.x;
  const dz = z - s.z;
  return Math.abs(dx * s.ux + dz * s.uz) <= s.halfLength + margin && Math.abs(-dx * s.uz + dz * s.ux) <= s.halfWidth + margin;
}

/**
 * Which buildings stand where a modelled landmark goes, and so are neither drawn nor collided with
 * as plain boxes: 1 for each such building. Decided by the middle of its outline.
 */
export function excludedBuildings(b: BuildingsData, landmarks: Landmarks | undefined): Uint8Array {
  const out = new Uint8Array(b.count);
  if (!landmarks) return out;
  const boxes: SiteBox[] = [...(landmarks.museum ? [landmarks.museum] : []), ...(landmarks.edenPark?.stands ?? [])];
  const silos = landmarks.silos ?? [];
  if (boxes.length === 0 && silos.length === 0) return out;
  for (let i = 0; i < b.count; i++) {
    const ring = b.buildingRingStart[i];
    const s = b.ringVertexStart[ring];
    const e = b.ringVertexStart[ring + 1];
    let x = 0;
    let z = 0;
    for (let v = s; v < e; v++) {
      x += b.xz[v * 2];
      z += b.xz[v * 2 + 1];
    }
    x /= e - s;
    z /= e - s;
    if (boxes.some((box) => inSiteBox(box, x, z, 3)) || silos.some((silo) => Math.hypot(x - silo.x, z - silo.z) < silo.r + 3)) out[i] = 1;
  }
  return out;
}

/* ---------------------------------------------------------------- the museum */

/** The parts of the museum, from its rectangle: the long side points at the front. */
export function museumShape(m: SiteBox) {
  const wall = m.roofY;
  return {
    /** The main block, front to about two thirds of the way back. */
    block: { from: -m.halfLength * 0.3, to: m.halfLength, halfWidth: m.halfWidth },
    /** The rounded southern end: an eight-sided drum behind the block. */
    apse: { at: -m.halfLength * 0.3, r: m.halfWidth * 0.92 },
    /** The raised hall behind the portico, and the dome over the southern atrium. */
    attic: { from: m.halfLength * 0.45, to: m.halfLength * 0.82, halfWidth: m.halfWidth * 0.42, top: wall + (m.topY - wall) * 0.62 },
    dome: { at: -m.halfLength * 0.42, r: Math.min(20, m.halfWidth * 0.46), top: m.topY },
    /** The portico: columns across the middle of the front, standing clear of the wall. */
    portico: { halfWidth: m.halfWidth * 0.55, columns: 8, out: 3.2, top: wall - 3.5 },
    wall,
    ground: m.groundY,
  };
}

/* ----------------------------------------------------------------- Eden Park */

/** Which way a stand faces the pitch: +1 if the pitch is on its +across side, -1 if on the other. */
export function standFacing(stand: SiteBox, pitch: SiteBox): number {
  const across = -(pitch.x - stand.x) * stand.uz + (pitch.z - stand.z) * stand.ux;
  return across >= 0 ? 1 : -1;
}

/** Floodlight towers: one beyond each corner of the pitch. */
export const FLOODLIGHT = { height: 58, r: 2.2 } as const;
export function floodlights(park: NonNullable<Landmarks['edenPark']>): { x: number; z: number; groundY: number }[] {
  const p = park.pitch;
  const out: { x: number; z: number; groundY: number }[] = [];
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      const along = su * (p.halfLength + 26);
      const across = sv * (p.halfWidth + 30);
      out.push({ x: p.x + p.ux * along - p.uz * across, z: p.z + p.uz * along + p.ux * across, groundY: p.groundY });
    }
  }
  return out;
}

/* ------------------------------------------------------------------- cranes */

type Crane = NonNullable<Landmarks['port']>['cranes'][number];

/**
 * A ship-to-shore crane, from where it stands, which way its boom points and how high the LiDAR
 * saw it reach. One that reaches very high has its boom raised (how they are parked); a lower one
 * has it down over the water.
 */
export function craneShape(c: Crane, groundY: number) {
  const reach = c.topY - groundY;
  const raised = reach > 95;
  return {
    raised,
    /** Rails are this far apart (along the boom) and the legs this far apart along the quay. */
    gauge: 30,
    width: 26,
    /** The level of the main girder, and the top of the frame above it. */
    girder: groundY + (raised ? 0.42 : 0.6) * reach,
    apex: raised ? groundY + 0.68 * reach : c.topY,
    /** How far the girder runs back over the yard, and the boom out over the water when it is down. */
    back: 24,
    out: raised ? 0 : 52,
    top: c.topY,
    ground: groundY,
  };
}

/* --------------------------------------------------------------- containers */

/** A container is 12.2 m long, 2.6 m high; a stack here is two wide. */
export const CONTAINER = { length: 12.2, height: 2.6, width: 5.2 } as const;
export const CONTAINER_COLOURS = ['#b4472e', '#2f5f8a', '#3f7d5a', '#c98a2b', '#8e969c'] as const;
/** Numbers per stack: x, z of its middle, how many high, and which colour. */
export const STACK_SIZE = 4;
/** No stack within this of the terminal's edge: the quays, where the cranes run. */
const APRON = 34;

function hash01(a: number, b: number, salt: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function insideRing(ring: readonly number[], px: number, pz: number): boolean {
  let hit = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDistance(ring: readonly number[], px: number, pz: number): number {
  let best = Infinity;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[j * 2];
    const az = ring[j * 2 + 1];
    const dx = ring[i * 2] - ax;
    const dz = ring[i * 2 + 1] - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
  }
  return best;
}

/** The long axis of a ring, as a unit vector: the direction of its longest edge. */
export function yardAxis(ring: readonly number[]): { ux: number; uz: number } {
  let best = 0;
  let ux = 1;
  let uz = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const dx = ring[i * 2] - ring[j * 2];
    const dz = ring[i * 2 + 1] - ring[j * 2 + 1];
    const len = Math.hypot(dx, dz);
    if (len > best) {
      best = len;
      ux = dx / len;
      uz = dz / len;
    }
  }
  return { ux, uz };
}

/**
 * Container stacks in the terminal's yard: in blocks of rows parallel to its longest quay, lanes
 * between them, clear of the quays themselves, and only where `free` says the ground is open (no
 * building, not water). About three slots in five hold a stack, one to four high. The same yard
 * every time. STACK_SIZE numbers a stack.
 */
export function containerStacks(port: NonNullable<Landmarks['port']>, free: (x: number, z: number) => boolean): Float32Array {
  const ring = port.ring;
  const { ux, uz } = yardAxis(ring);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const u = ring[i] * ux + ring[i + 1] * uz;
    const v = -ring[i] * uz + ring[i + 1] * ux;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const out: number[] = [];
  // Along the rows: runs of eight containers end to end, then a lane. Across: three stacks, then a lane.
  const pitchU = CONTAINER.length + 0.8;
  const pitchV = CONTAINER.width + 0.6;
  for (let iv = 0, v = minV; v < maxV; iv++, v += pitchV + (iv % 3 === 0 ? 15 : 0)) {
    for (let iu = 0, u = minU; u < maxU; iu++, u += pitchU + (iu % 8 === 0 ? 17 : 0)) {
      // A whole run is busy or quiet together, so the yard has full blocks and bare ground.
      const run = hash01(Math.floor(iu / 8), Math.floor(iv / 3), 1);
      if (run < 0.25 || hash01(iu, iv, 2) > 0.55 + 0.4 * run) continue;
      const x = u * ux - v * uz;
      const z = u * uz + v * ux;
      if (!insideRing(ring, x, z) || edgeDistance(ring, x, z) < APRON) continue;
      const hl = CONTAINER.length / 2;
      const hw = CONTAINER.width / 2;
      let open = true;
      for (const [su, sv] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        if (!free(x + ux * hl * su - uz * hw * sv, z + uz * hl * su + ux * hw * sv)) open = false;
      }
      if (!open) continue;
      const levels = 1 + Math.floor(hash01(iu, iv, 3) * 3 + run * 1.2);
      out.push(x, z, Math.min(4, levels), Math.floor(hash01(iu, iv, 4) * CONTAINER_COLOURS.length));
    }
  }
  return Float32Array.from(out);
}

/* ---------------------------------------------------------------- colliders */

/** What of these landmarks can be hit: every part that is drawn is inside one of these. */
export function siteColliders(landmarks: Landmarks): SiteCollider[] {
  const out: SiteCollider[] = [];
  const along = (s: { x: number; z: number; ux: number; uz: number }, a: number, v = 0) => ({ cx: s.x + s.ux * a - s.uz * v, cz: s.z + s.uz * a + s.ux * v });

  const m = landmarks.museum;
  if (m) {
    const shape = museumShape(m);
    // The whole rectangle, portico and steps included, up to the roof; then what stands above it.
    out.push({ kind: 'box', name: 'Auckland Museum', ...along(m, 2), ux: m.ux, uz: m.uz, hu: m.halfLength + 6, hv: m.halfWidth + 1, y0: shape.ground - 6, y1: shape.wall + 1 });
    out.push({ kind: 'box', name: 'Auckland Museum', ...along(m, (shape.attic.from + shape.attic.to) / 2), ux: m.ux, uz: m.uz, hu: (shape.attic.to - shape.attic.from) / 2, hv: shape.attic.halfWidth, y0: shape.wall, y1: shape.attic.top });
    const dome = along(m, shape.dome.at);
    out.push({ kind: 'cylinder', name: 'Auckland Museum dome', x: dome.cx, z: dome.cz, r: shape.dome.r, y0: shape.wall, y1: shape.dome.top });
  }

  const park = landmarks.edenPark;
  if (park) {
    for (const s of park.stands) {
      // A stand's roof reaches out over its seats, a little beyond its own outline.
      out.push({ kind: 'box', name: 'Eden Park stand', cx: s.x, cz: s.z, ux: s.ux, uz: s.uz, hu: s.halfLength + 1, hv: s.halfWidth + 7, y0: s.groundY - 6, y1: s.topY + 1.5 });
    }
    for (const f of floodlights(park)) out.push({ kind: 'cylinder', name: 'Eden Park floodlight', x: f.x, z: f.z, r: FLOODLIGHT.r + 4, y0: f.groundY - 3, y1: f.groundY + FLOODLIGHT.height + 5 });
  }

  for (const s of landmarks.silos ?? []) out.push({ kind: 'cylinder', name: 'Silo', x: s.x, z: s.z, r: s.r + 0.4, y0: s.groundY - 3, y1: s.topY + 1.6 });

  const w = landmarks.wynyardCrossing;
  if (w) {
    const dx = w.b.x - w.a.x;
    const dz = w.b.z - w.a.z;
    const len = Math.hypot(dx, dz) || 1;
    const axis = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2, ux: dx / len, uz: dz / len };
    out.push({ kind: 'box', name: 'Wynyard Crossing', cx: axis.x, cz: axis.z, ux: axis.ux, uz: axis.uz, hu: len / 2, hv: w.halfWidth + 1.2, y0: -6, y1: w.deckY + 2 });
    // The two lifting spans' masts, a fifth of the way in from the middle on each side.
    for (const side of [-1, 1]) out.push({ kind: 'box', name: 'Wynyard Crossing', ...along(axis, side * len * 0.2), ux: axis.ux, uz: axis.uz, hu: 4, hv: w.halfWidth + 2.5, y0: w.deckY, y1: w.deckY + CROSSING_MAST + 1 });
  }

  const port = landmarks.port;
  if (port) {
    for (const c of port.cranes) {
      const s = craneShape(c, port.groundY);
      // The frame on its four legs, and the girder running back over the yard.
      out.push({ kind: 'box', name: 'Port crane', ...along(c, -s.back / 2), ux: c.ux, uz: c.uz, hu: (s.gauge + s.back) / 2 + 2, hv: s.width / 2 + 2, y0: s.ground - 3, y1: s.apex + 2 });
      // The boom: standing up at the water's edge, or out flat over the water.
      if (s.raised) out.push({ kind: 'box', name: 'Port crane', ...along(c, s.gauge / 2 + 6), ux: c.ux, uz: c.uz, hu: 9, hv: 5, y0: s.girder - 3, y1: s.top + 2 });
      else out.push({ kind: 'box', name: 'Port crane', ...along(c, s.gauge / 2 + s.out / 2), ux: c.ux, uz: c.uz, hu: s.out / 2 + 2, hv: 5, y0: s.girder - 4, y1: s.girder + 5 });
    }
  }
  return out;
}

/** How high the footbridge's masts stand above its deck. */
export const CROSSING_MAST = 13;
