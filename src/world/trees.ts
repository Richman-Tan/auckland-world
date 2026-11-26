/**
 * Trees. Pure (no three, no DOM): where they stand is worked out in the worker and tested in Node.
 *
 * The map does not list trees. It says which six-metre cells of land are under tree canopy and
 * roughly how tall that canopy is (land.bin, measured from LiDAR), and trees are stood in those
 * cells by rule: the same trees every time, because every choice is a hash of the cell. A tall
 * canopy gets fewer, bigger trees, a low one more and smaller. What kind a tree is follows where
 * it is: pohutukawa near the sea, the odd Norfolk pine where the canopy is tall, round-crowned
 * broadleaves everywhere else.
 *
 * Only the trees near the plane are ever drawn, so they are grouped by tile like the roads
 * (nearSet.ts), and gathered into the three species' instance buffers when the set of near tiles
 * changes.
 */
import { CANOPY_TYPICAL, type LandGrid } from '../shared/land';
import type { Bounds } from '../shared/mapFormat';
import { type TileGrid, tileGrid, tileOf } from './ribbons';

export const SPECIES = ['broadleaf', 'pine', 'pohutukawa'] as const;
export type Species = (typeof SPECIES)[number];
export const BROADLEAF = 0;
export const PINE = 1;
export const POHUTUKAWA = 2;

/** Numbers per tree in `trees`: x, y (the ground), z, height. */
export const TREE_SIZE = 4;

export interface TreeField {
  count: number;
  /** TREE_SIZE numbers a tree, grouped by tile. */
  trees: Float32Array;
  /** Two bytes a tree: its species, and its own seed (0-255) for turning and tinting it. */
  look: Uint8Array;
  /** Tile t owns trees [tileStart[t], tileStart[t + 1]). */
  tileStart: Uint32Array;
  tiles: TileGrid;
}

export interface ScatterOptions {
  tileSize?: number;
  /** Lowest ground a tree may stand on: nothing grows in the sea. */
  waterLevel?: number;
}

/** The share of canopy cells of each height class that get a tree: tall trees have wide crowns, so fewer cells need one. */
export const TREE_DENSITY = [0, 0.42, 0.36, 0.28] as const;
/** How near the sea counts as the coast, for pohutukawa. */
const COAST_M = 70;

/** 0..1 from a cell and a salt, the same every time. */
export function cellHash(c: number, r: number, salt: number): number {
  let h = (Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(r | 0, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** What kind of tree stands here, from how tall the canopy is, whether the sea is close, and the cell's own number. */
export function speciesFor(canopy: number, coastal: boolean, pick: number): number {
  if (coastal && canopy <= 2) return pick < 0.62 ? POHUTUKAWA : BROADLEAF;
  if (canopy === 3) return pick < 0.22 ? PINE : pick < 0.3 ? POHUTUKAWA : BROADLEAF;
  return pick < 0.07 ? POHUTUKAWA : pick < 0.1 ? PINE : BROADLEAF;
}

/**
 * Stand trees in the canopy cells of `land`. `heightAt` is the ground as drawn (the terrain mesh),
 * so trunks meet it; a tree whose spot is in the sea is left out.
 */
export function scatterTrees(land: LandGrid, bounds: Bounds, heightAt: (x: number, z: number) => number, opts: ScatterOptions = {}): TreeField {
  const tiles = tileGrid(bounds, opts.tileSize ?? 150);
  const water = opts.waterLevel ?? 0;
  const perTile: number[][] = Array.from({ length: tiles.nx * tiles.nz }, () => []);
  const perTileLook: number[][] = Array.from({ length: tiles.nx * tiles.nz }, () => []);
  const cell = land.cell;
  let count = 0;
  for (let r = 0; r < land.height; r++) {
    for (let c = 0; c < land.width; c++) {
      const k = land.canopy[r * land.width + c];
      if (!k || cellHash(c, r, 1) >= TREE_DENSITY[k]) continue;
      // Somewhere in the middle two thirds of its cell.
      const x = bounds.minX + (c + 0.17 + 0.66 * cellHash(c, r, 2)) * cell;
      const z = bounds.minZ + (r + 0.17 + 0.66 * cellHash(c, r, 3)) * cell;
      if (x <= bounds.minX + 1 || x >= bounds.maxX - 1 || z <= bounds.minZ + 1 || z >= bounds.maxZ - 1) continue;
      const y = heightAt(x, z);
      if (!(y > water + 0.2)) continue;
      const coastal =
        heightAt(Math.min(bounds.maxX - 1, x + COAST_M), z) <= water ||
        heightAt(Math.max(bounds.minX + 1, x - COAST_M), z) <= water ||
        heightAt(x, Math.min(bounds.maxZ - 1, z + COAST_M)) <= water ||
        heightAt(x, Math.max(bounds.minZ + 1, z - COAST_M)) <= water;
      const species = speciesFor(k, coastal, cellHash(c, r, 4));
      // As tall as the canopy there, give or take a fifth; pines stand above it, pohutukawa spread below it.
      const height = CANOPY_TYPICAL[k] * (0.8 + 0.4 * cellHash(c, r, 5)) * (species === PINE ? 1.35 : species === POHUTUKAWA ? 0.85 : 1);
      const t = tileOf(tiles, x, z);
      perTile[t].push(x, y, z, height);
      perTileLook[t].push(species, Math.floor(cellHash(c, r, 6) * 256) & 255);
      count++;
    }
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

export function treeTransferables(f: TreeField): ArrayBuffer[] {
  return [f.trees, f.look, f.tileStart].map((a) => a.buffer as ArrayBuffer);
}

/**
 * The trees of `near` tiles nearest (x, z), sorted into one buffer per species. Each `out[s]` takes
 * up to its length / TREE_SIZE + 1 numbers a tree (x, y, z, height, seed); returns how many of each
 * species were written. At most `cap` trees in all: tiles are taken nearest first, so what is left
 * out is what is furthest away.
 */
export const INSTANCE_SIZE = 5;
export function gatherTrees(f: TreeField, near: readonly number[], x: number, z: number, cap: number, out: readonly Float32Array[]): number[] {
  const g = f.tiles;
  const order = [...near].sort((a, b) => {
    const da = Math.hypot(g.x0 + ((a % g.nx) + 0.5) * g.size - x, g.z0 + (Math.floor(a / g.nx) + 0.5) * g.size - z);
    const db = Math.hypot(g.x0 + ((b % g.nx) + 0.5) * g.size - x, g.z0 + (Math.floor(b / g.nx) + 0.5) * g.size - z);
    return da - db;
  });
  const written = out.map(() => 0);
  let total = 0;
  for (const t of order) {
    for (let i = f.tileStart[t]; i < f.tileStart[t + 1]; i++) {
      if (total >= cap) return written;
      const s = f.look[i * 2];
      const buf = out[s];
      const k = written[s];
      if (!buf || (k + 1) * INSTANCE_SIZE > buf.length) continue;
      buf[k * INSTANCE_SIZE] = f.trees[i * TREE_SIZE];
      buf[k * INSTANCE_SIZE + 1] = f.trees[i * TREE_SIZE + 1];
      buf[k * INSTANCE_SIZE + 2] = f.trees[i * TREE_SIZE + 2];
      buf[k * INSTANCE_SIZE + 3] = f.trees[i * TREE_SIZE + 3];
      buf[k * INSTANCE_SIZE + 4] = f.look[i * 2 + 1];
      written[s] = k + 1;
      total++;
    }
  }
  return written;
}

/* ------------------------------------------------------------------ shapes */

/** A tree one unit tall, standing on y = 0: flat triangles, and how light each corner is (0 marks the trunk). */
export interface TreeShape {
  positions: Float32Array;
  /** 0 on the trunk; on the crown, its tone: darker underneath, lighter on top. */
  tone: Float32Array;
  triangles: number;
}

/** Rings of a shape turned about the trunk: height and radius, both as a share of the tree's height. */
type Ring = readonly [y: number, r: number];

function lathe(pos: number[], tone: number[], rings: readonly Ring[], sides: number, toneOf: (y: number) => number, turn = 0) {
  const at = (ring: Ring, i: number): [number, number, number] => {
    const a = ((i + turn) / sides) * Math.PI * 2;
    return [Math.cos(a) * ring[1], ring[0], Math.sin(a) * ring[1]];
  };
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    // Wound to face away from the trunk.
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const mx = (a[0] + b[0] + c[0]) / 3;
    const mz = (a[2] + b[2] + c[2]) / 3;
    const my = (a[1] + b[1] + c[1]) / 3 - (rings[0][0] + rings[rings.length - 1][0]) / 2;
    const out = nx * mx + nz * mz + ny * my * 0.5 >= 0;
    for (const p of out ? [a, b, c] : [a, c, b]) {
      pos.push(p[0], p[1], p[2]);
      tone.push(toneOf(p[1]));
    }
  };
  for (let k = 0; k + 1 < rings.length; k++) {
    const lo = rings[k];
    const hi = rings[k + 1];
    for (let i = 0; i < sides; i++) {
      if (lo[1] > 0 && hi[1] > 0) {
        tri(at(lo, i), at(lo, i + 1), at(hi, i + 1));
        tri(at(lo, i), at(hi, i + 1), at(hi, i));
      } else if (lo[1] > 0) {
        tri(at(lo, i), at(lo, i + 1), [0, hi[0], 0]);
      } else if (hi[1] > 0) {
        tri([0, lo[0], 0], at(hi, i + 1), at(hi, i));
      }
    }
  }
}

/** The three species, each a trunk and a crown, chunky enough to read at the site's pixel size. */
export function treeShape(species: number): TreeShape {
  const pos: number[] = [];
  const tone: number[] = [];
  const trunk = () => 0;
  if (species === PINE) {
    // A Norfolk pine: a straight trunk and three tiers of branches, each a cone, narrowing upward.
    lathe(pos, tone, [[0, 0.03], [0.3, 0.026]], 3, trunk);
    lathe(pos, tone, [[0.2, 0.2], [0.5, 0.06]], 4, (y) => 0.78 + 0.5 * (y - 0.2), 0.5);
    lathe(pos, tone, [[0.46, 0.15], [0.76, 0.045]], 4, (y) => 0.86 + 0.5 * (y - 0.46));
    lathe(pos, tone, [[0.72, 0.1], [1, 0]], 4, (y) => 0.95 + 0.6 * (y - 0.72), 0.5);
  } else if (species === POHUTUKAWA) {
    // A pohutukawa: a short thick trunk and a wide, low dome, as broad as it is tall.
    lathe(pos, tone, [[0, 0.075], [0.36, 0.06]], 3, trunk);
    lathe(pos, tone, [[0.26, 0], [0.42, 0.5], [0.78, 0.4], [1, 0]], 6, (y) => 0.7 + 0.55 * (y - 0.26));
  } else {
    // A broadleaf: a trunk and a rounded crown.
    lathe(pos, tone, [[0, 0.045], [0.38, 0.035]], 3, trunk);
    lathe(pos, tone, [[0.3, 0], [0.5, 0.3], [0.82, 0.24], [1, 0]], 5, (y) => 0.72 + 0.55 * (y - 0.3));
  }
  return { positions: Float32Array.from(pos), tone: Float32Array.from(tone), triangles: pos.length / 9 };
}
