/**
 * Pure building extrusion (no DOM, no three): runs in the geometry worker and in Node tests.
 *
 * Each building gets shared top and bottom ring vertices. Walls are quads between them, wound
 * so that they face outward for counter-clockwise outer rings on a north-up map (holes face
 * into the courtyard). A flat roof is triangulated with earcut over the top ring (outer + holes)
 * and faces +y. On the high tier a house whose footprint allows it gets a hip or gable roof
 * instead (shared/roofs.ts): its walls stop at the eaves and two more vertices carry the ridge,
 * at the height the map records as the building's top. A tower may carry a plant room.
 *
 * Vertex attributes per chunk: Float32 positions (x, y, z world metres) and four Uint16, never
 * normalised and the same on every vertex of a building, which is how the building shader knows
 * what it is drawing (STYLE_* below).
 */
import earcut from 'earcut';
import type { Bounds, BuildingsData } from '../shared/mapFormat';
import { buildingSeed, pitchedStyle, plantRoom, roofPlan } from '../shared/roofs';

/** Numbers per vertex in `style`. */
export const STYLE_SIZE = 4;
/** [0] the style byte, plus the building's own seed (0-255) times 256. */
export const styleWord = (style: number, seed: number) => (style & 255) | ((seed & 255) << 8);
/** [1] height base to top, [2] height of the base above sea level plus STYLE_BASE_OFFSET, [3] height of the eaves above the base: all in decimetres. */
export const STYLE_BASE_OFFSET = 1000;
const dm = (metres: number) => Math.min(65535, Math.max(0, Math.round(metres * 10)));
/** The style a plant room is drawn in: dark cladding under a dark roof. */
export const PLANT_ROOM_STYLE = 0xff;

export type QualityTier = 'high' | 'low';

export interface ChunkGeometry {
  /** Chunk grid cell, e.g. "3,4". */
  key: string;
  buildingCount: number;
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** STYLE_SIZE numbers per vertex. */
  style: Uint16Array;
  indices: Uint16Array | Uint32Array;
  /** Bounding sphere: centre + radius. */
  sphere: { x: number; y: number; z: number; r: number };
}

export interface ExtrudeOptions {
  bounds: Bounds;
  /** Chunk edge length in metres. */
  chunkSize?: number;
  quality?: QualityTier;
}

export const CHUNK_SIZE = 1000;

/** Footprint area (outer ring only), m^2, absolute. */
export function footprintArea(b: BuildingsData, i: number): number {
  const ring = b.buildingRingStart[i];
  const s = b.ringVertexStart[ring];
  const e = b.ringVertexStart[ring + 1];
  let a = 0;
  const n = e - s;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    a += b.xz[(s + k) * 2] * b.xz[(s + j) * 2 + 1] - b.xz[(s + j) * 2] * b.xz[(s + k) * 2 + 1];
  }
  return Math.abs(a) / 2;
}

/** Should this building be dropped at the given quality? (low: under 50 m^2 and under 8 m tall.) */
export function skipBuilding(b: BuildingsData, i: number, quality: QualityTier): boolean {
  if (quality !== 'low') return false;
  return b.topY[i] - b.baseY[i] < 8 && footprintArea(b, i) < 50;
}

/** Which chunk a building belongs to (by the centre of its outer ring's bounding box). */
export function chunkOf(b: BuildingsData, i: number, bounds: Bounds, size: number): { cx: number; cz: number } {
  const ring = b.buildingRingStart[i];
  const s = b.ringVertexStart[ring];
  const e = b.ringVertexStart[ring + 1];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let k = s; k < e; k++) {
    const x = b.xz[k * 2];
    const z = b.xz[k * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / size));
  const nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / size));
  const cx = Math.min(nx - 1, Math.max(0, Math.floor(((minX + maxX) / 2 - bounds.minX) / size)));
  const cz = Math.min(nz - 1, Math.max(0, Math.floor(((minZ + maxZ) / 2 - bounds.minZ) / size)));
  return { cx, cz };
}

/** Group building indices into chunks. Every kept building lands in exactly one chunk. */
export function groupIntoChunks(
  b: BuildingsData,
  bounds: Bounds,
  size = CHUNK_SIZE,
  quality: QualityTier = 'high',
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (let i = 0; i < b.count; i++) {
    if (skipBuilding(b, i, quality)) continue;
    const { cx, cz } = chunkOf(b, i, bounds, size);
    const key = `${cx},${cz}`;
    let list = out.get(key);
    if (!list) out.set(key, (list = []));
    list.push(i);
  }
  return out;
}

/** Signed area in the (x, -z) plane: positive = counter-clockwise on a north-up map. */
function ringArea(xz: Float32Array, s: number, e: number): number {
  let a = 0;
  const n = e - s;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const x1 = xz[(s + k) * 2];
    const y1 = -xz[(s + k) * 2 + 1];
    const x2 = xz[(s + j) * 2];
    const y2 = -xz[(s + j) * 2 + 1];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Counts for sizing buffers: enough for any roof the building could be given. */
function countChunk(b: BuildingsData, ids: number[]): { verts: number; tris: number } {
  let verts = 0;
  let tris = 0;
  for (const i of ids) {
    const r0 = b.buildingRingStart[i];
    const r1 = b.buildingRingStart[i + 1];
    let v = 0;
    for (let r = r0; r < r1; r++) v += b.ringVertexStart[r + 1] - b.ringVertexStart[r];
    // The two rings, a ridge's two vertices and a plant room's eight.
    verts += v * 2 + 10;
    // walls: 2 per edge (edges = vertices); roof: v - 2 + 2 * holes flat, or 2 per edge pitched; a plant room's 10
    tris += v * 2 + v * 2 + 2 * (r1 - r0) + 10;
  }
  return { verts, tris };
}

export function extrudeChunk(b: BuildingsData, ids: number[], key: string, quality: QualityTier = 'high'): ChunkGeometry {
  const cap = countChunk(b, ids);
  const positions = new Float32Array(cap.verts * 3);
  const style = new Uint16Array(cap.verts * STYLE_SIZE);
  const idx = new Uint32Array(cap.tris * 3);
  let nv = 0;
  let ni = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const bi of ids) {
    const r0 = b.buildingRingStart[bi];
    const r1 = b.buildingRingStart[bi + 1];
    const baseY = b.baseY[bi];
    const topY = b.topY[bi];
    const st = b.style[bi];
    const height = topY - baseY;
    // The building's own number comes from its first corner as stored, so it is the same wherever it is asked for.
    const first = b.ringVertexStart[r0];
    const seed = buildingSeed(b.xz[first * 2], b.xz[first * 2 + 1]);
    const word = styleWord(st, seed);
    const put = (x: number, y: number, z: number, w0: number, heightDm: number, eaveDm: number): number => {
      positions[nv * 3] = x;
      positions[nv * 3 + 1] = y;
      positions[nv * 3 + 2] = z;
      style[nv * STYLE_SIZE] = w0;
      style[nv * STYLE_SIZE + 1] = heightDm;
      style[nv * STYLE_SIZE + 2] = dm(baseY + STYLE_BASE_OFFSET / 10);
      style[nv * STYLE_SIZE + 3] = eaveDm;
      return nv++;
    };

    // Gather rings, normalised: outer CCW, holes CW (north-up). Local copies of (x, z).
    const rings: Float32Array[] = [];
    for (let r = r0; r < r1; r++) {
      const s = b.ringVertexStart[r];
      const e = b.ringVertexStart[r + 1];
      const n = e - s;
      const area = ringArea(b.xz, s, e);
      const wantCcw = r === r0;
      const reverse = wantCcw ? area < 0 : area > 0;
      const out = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) {
        const src = reverse ? s + (n - 1 - k) : s + k;
        out[k * 2] = b.xz[src * 2];
        out[k * 2 + 1] = b.xz[src * 2 + 1];
      }
      rings.push(out);
    }

    // A pitched roof, where the footprint and the tier allow one: the walls then stop at the eaves.
    const plan = quality === 'high' && rings.length === 1 ? roofPlan(rings[0], height, seed, pitchedStyle(st)) : null;
    const pitched = plan !== null && plan.kind !== 'flat';
    const wallTop = pitched ? topY - plan.rise : topY;
    const heightDm = dm(height);
    const eaveDm = dm(wallTop - baseY);

    const bottomStart = nv;
    // Layout: for each ring, n top vertices then n bottom vertices.
    const ringTop: number[] = [];
    const ringBottom: number[] = [];
    for (const ring of rings) {
      const n = ring.length / 2;
      ringTop.push(nv);
      for (let k = 0; k < n; k++) put(ring[k * 2], wallTop, ring[k * 2 + 1], word, heightDm, eaveDm);
      ringBottom.push(nv);
      for (let k = 0; k < n; k++) put(ring[k * 2], baseY, ring[k * 2 + 1], word, heightDm, eaveDm);
    }

    // Walls: bottom i, bottom j, top j, top i.
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      const n = ring.length / 2;
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const dx = ring[j * 2] - ring[k * 2];
        const dz = ring[j * 2 + 1] - ring[k * 2 + 1];
        if (dx * dx + dz * dz < 1e-6) continue;
        const a = ringBottom[r] + k;
        const bb = ringBottom[r] + j;
        const c = ringTop[r] + j;
        const d = ringTop[r] + k;
        idx[ni++] = a;
        idx[ni++] = bb;
        idx[ni++] = c;
        idx[ni++] = a;
        idx[ni++] = c;
        idx[ni++] = d;
      }
    }

    /** A roof triangle, wound to face the sky (or left as given if it stands upright). */
    const roofTri = (a: number, bb: number, c: number) => {
      const ux = positions[bb * 3] - positions[a * 3];
      const uz = positions[bb * 3 + 2] - positions[a * 3 + 2];
      const vx = positions[c * 3] - positions[a * 3];
      const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
      const up = uz * vx - ux * vz;
      // Nothing to draw where three corners coincide (a square hip roof's ridge is a point).
      const uy = positions[bb * 3 + 1] - positions[a * 3 + 1];
      const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
      if (Math.abs(up) < 1e-9 && Math.abs(uy * vz - uz * vy) < 1e-9 && Math.abs(ux * vy - uy * vx) < 1e-9) return;
      idx[ni++] = a;
      idx[ni++] = up < 0 ? c : bb;
      idx[ni++] = up < 0 ? bb : c;
    };

    if (pitched) {
      // Each wall's top edge runs up to the ridge: a triangle where both corners go to the same
      // end of it, a quad (two triangles) where they go to different ends.
      const ring = rings[0];
      const n = ring.length / 2;
      const ridge = [put(plan.a[0], topY, plan.a[1], word, heightDm, eaveDm), put(plan.b[0], topY, plan.b[1], word, heightDm, eaveDm)];
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const tk = ringTop[0] + k;
        const tj = ringTop[0] + j;
        roofTri(tk, tj, ridge[plan.end[j]]);
        if (plan.end[k] !== plan.end[j]) roofTri(tk, ridge[plan.end[j]], ridge[plan.end[k]]);
      }
    } else {
      flatRoof();
    }

    // A plant room on a tower: a box on the roof, in its own dark style. Collision is told too (roofExtra).
    if (rings.length === 1) {
      const room = plantRoom(b.xz.subarray(first * 2, b.ringVertexStart[r0 + 1] * 2), height, seed);
      if (room) {
        const w = styleWord(PLANT_ROOM_STYLE, seed);
        const hd = dm(height + room.height);
        const top = room.corners.map(([x, z]) => put(x, topY + room.height, z, w, hd, hd));
        const foot = room.corners.map(([x, z]) => put(x, topY, z, w, hd, hd));
        // Walls face outward whichever way the corners run: wound by the box's own centre.
        const cx = (room.corners[0][0] + room.corners[2][0]) / 2;
        const cz = (room.corners[0][1] + room.corners[2][1]) / 2;
        for (let k = 0; k < 4; k++) {
          const j = (k + 1) % 4;
          const [x0, z0] = room.corners[k];
          const [x1, z1] = room.corners[j];
          // A wall wound (bottom k, bottom j, top j) faces away from whatever is on its left on a
          // north-up map, which in (x, z), with z running south, is where this is negative.
          const out = (x1 - x0) * (cz - z0) - (z1 - z0) * (cx - x0) < 0;
          const [p, q] = out ? [k, j] : [j, k];
          idx[ni++] = foot[p];
          idx[ni++] = foot[q];
          idx[ni++] = top[q];
          idx[ni++] = foot[p];
          idx[ni++] = top[q];
          idx[ni++] = top[p];
        }
        roofTri(top[0], top[1], top[2]);
        roofTri(top[0], top[2], top[3]);
      }
    }

    // A flat roof: earcut over the top ring (outer + holes).
    function flatRoof() {
    const flat: number[] = [];
    const holes: number[] = [];
    const map: number[] = [];
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) holes.push(flat.length / 2);
      const ring = rings[r];
      const n = ring.length / 2;
      for (let k = 0; k < n; k++) {
        flat.push(ring[k * 2], ring[k * 2 + 1]);
        map.push(ringTop[r] + k);
      }
    }
    const tri = earcut(flat, holes.length ? holes : undefined, 2);
    for (let t = 0; t < tri.length; t += 3) {
      let a = tri[t];
      let bb = tri[t + 1];
      let c = tri[t + 2];
      // Normal y of (a, b, c) = (b - a) x (c - a) -> u.z * v.x - u.x * v.z; make it positive.
      const ux = flat[bb * 2] - flat[a * 2];
      const uz = flat[bb * 2 + 1] - flat[a * 2 + 1];
      const vx = flat[c * 2] - flat[a * 2];
      const vz = flat[c * 2 + 1] - flat[a * 2 + 1];
      if (uz * vx - ux * vz < 0) {
        const tmp = bb;
        bb = c;
        c = tmp;
      }
      idx[ni++] = map[a];
      idx[ni++] = map[bb];
      idx[ni++] = map[c];
    }
    }
    for (let v = bottomStart; v < nv; v++) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let r2 = 0;
  for (let v = 0; v < nv; v++) {
    const dx = positions[v * 3] - cx;
    const dy = positions[v * 3 + 1] - cy;
    const dz = positions[v * 3 + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }

  const pos = positions.slice(0, nv * 3);
  const sty = style.slice(0, nv * STYLE_SIZE);
  const indices = nv < 65536 ? Uint16Array.from(idx.subarray(0, ni)) : idx.slice(0, ni);
  return {
    key,
    buildingCount: ids.length,
    positions: pos,
    style: sty,
    indices,
    sphere: { x: cx, y: cy, z: cz, r: Math.sqrt(r2) },
  };
}

/** Extrude every building into 1 km chunks (at most (width/size) * (height/size) = 64 for the shipped world). */
export function extrudeBuildings(b: BuildingsData, opts: ExtrudeOptions): ChunkGeometry[] {
  const groups = groupIntoChunks(b, opts.bounds, opts.chunkSize ?? CHUNK_SIZE, opts.quality ?? 'high');
  const out: ChunkGeometry[] = [];
  for (const [key, ids] of groups) out.push(extrudeChunk(b, ids, key, opts.quality ?? 'high'));
  return out;
}
