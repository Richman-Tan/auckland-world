/**
 * Piers and moored boats, from harbour.bin. Pure (no three, no DOM): built in the worker.
 *
 * A pier is its outline raised into a low deck over the water: a top, and a skirt down to just
 * under the surface, so it reads from above and from alongside. Boats are not geometry here: each
 * berth becomes one entry in a field of instances, grouped by tile like the trees, and the scene
 * draws the nearest of them (world/trees.ts, gatherTrees).
 */
import earcut from 'earcut';
import type { Bounds, HarbourData } from '../shared/mapFormat';
import { tileGrid, tileOf } from './ribbons';
import { TREE_SIZE, type TreeField } from './trees';

export interface PierMesh {
  /** Flat triangles: x, y, z per corner. */
  positions: Float32Array;
  /** r, g, b, a per corner (a is 255: an ordinary lit face). */
  colors: Uint8Array;
  triangles: number;
}

/** How high a deck stands above the water, and how far under it the skirt goes. */
export const PIER = { floatingDeck: 0.7, fixedDeck: 1.7, skirt: 0.5 } as const;

const FLOATING = { top: [0xbd, 0xb8, 0xab], side: [0x86, 0x82, 0x77] } as const;
const FIXED = { top: [0x9c, 0x90, 0x7c], side: [0x66, 0x5c, 0x4f] } as const;

export function buildPierMesh(data: HarbourData, waterLevel: number): PierMesh {
  const pos: number[] = [];
  const col: number[] = [];
  const push = (x: number, y: number, z: number, c: readonly number[]) => {
    pos.push(x, y, z);
    col.push(c[0], c[1], c[2], 255);
  };
  for (const pier of data.piers) {
    const ring = pier.ring;
    const n = ring.length / 2;
    if (n < 3) continue;
    const paint = pier.floating ? FLOATING : FIXED;
    const top = waterLevel + (pier.floating ? PIER.floatingDeck : PIER.fixedDeck);
    const foot = waterLevel - PIER.skirt;
    // Which way the outline runs, seen on a north-up map (x east, -z north): positive is anticlockwise.
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += ring[j * 2] * -ring[i * 2 + 1] - ring[i * 2] * -ring[j * 2 + 1];
    const ccw = area > 0;
    // The deck, facing up.
    const tri = earcut(ring as number[], undefined, 2);
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t];
      let b = tri[t + 1];
      let c = tri[t + 2];
      const ux = ring[b * 2] - ring[a * 2];
      const uz = ring[b * 2 + 1] - ring[a * 2 + 1];
      const vx = ring[c * 2] - ring[a * 2];
      const vz = ring[c * 2 + 1] - ring[a * 2 + 1];
      if (uz * vx - ux * vz < 0) [b, c] = [c, b];
      for (const k of [a, b, c]) push(ring[k * 2], top, ring[k * 2 + 1], paint.top);
    }
    // The skirt, facing out.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [p, q] = ccw ? [i, j] : [j, i];
      const x0 = ring[p * 2];
      const z0 = ring[p * 2 + 1];
      const x1 = ring[q * 2];
      const z1 = ring[q * 2 + 1];
      if ((x1 - x0) ** 2 + (z1 - z0) ** 2 < 1e-6) continue;
      push(x0, foot, z0, paint.side);
      push(x1, foot, z1, paint.side);
      push(x1, top, z1, paint.side);
      push(x0, foot, z0, paint.side);
      push(x1, top, z1, paint.side);
      push(x0, top, z0, paint.side);
    }
  }
  return { positions: Float32Array.from(pos), colors: Uint8Array.from(col), triangles: pos.length / 9 };
}

/** Kinds of moored boat. */
export const BOAT_KINDS = ['yacht', 'launch'] as const;
export const YACHT = 0;
export const LAUNCH = 1;

/** 0..1 from a berth's place, the same every time. */
export function berthHash(x: number, z: number, salt: number): number {
  let h = (Math.imul(Math.round(x * 4), 0x9e3779b1) ^ Math.imul(Math.round(z * 4), 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * The boats as a field of instances: x, the waterline, z and length for each, and two bytes, its
 * kind and its heading (256 to the turn). Two boats in three are yachts.
 */
export function boatField(data: HarbourData, bounds: Bounds, waterLevel: number, tileSize = 200): TreeField {
  const tiles = tileGrid(bounds, tileSize);
  const perTile: number[][] = Array.from({ length: tiles.nx * tiles.nz }, () => []);
  const perTileLook: number[][] = Array.from({ length: tiles.nx * tiles.nz }, () => []);
  let count = 0;
  for (const b of data.berths) {
    if (b.x < bounds.minX || b.x > bounds.maxX || b.z < bounds.minZ || b.z > bounds.maxZ) continue;
    const t = tileOf(tiles, b.x, b.z);
    perTile[t].push(b.x, waterLevel, b.z, b.length);
    const turn = (((b.heading / (2 * Math.PI)) % 1) + 1) % 1;
    perTileLook[t].push(berthHash(b.x, b.z, 1) < 0.66 ? YACHT : LAUNCH, Math.round(turn * 256) & 255);
    count++;
  }
  const trees = new Float32Array(count * TREE_SIZE);
  const look = new Uint8Array(count * 2);
  const tileStart = new Uint32Array(perTile.length + 1);
  let n = 0;
  perTile.forEach((t, i) => {
    tileStart[i] = n;
    trees.set(t, n * TREE_SIZE);
    look.set(perTileLook[i], n * 2);
    n += t.length / TREE_SIZE;
  });
  tileStart[perTile.length] = n;
  return { count, trees, look, tileStart, tiles };
}
