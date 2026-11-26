/**
 * Which map tiles are close enough to the camera to draw their close-up detail. Pure.
 *
 * A tile comes in when any part of it is within `radius`, and only goes out again once it is
 * `slack` further away than that, so flying along a tile boundary does not flick it on and off
 * (each change means rewriting an index buffer).
 */
import type { TileGrid } from './ribbons';

export interface NearSet {
  /** Tiles to draw, in ascending order. The same array until something changes. */
  readonly tiles: readonly number[];
  /** Returns true if the set changed. */
  update(x: number, z: number, radius: number): boolean;
}

/** Distance from a point to the nearest point of tile t (0 inside it). */
export function tileDistance(g: TileGrid, t: number, x: number, z: number): number {
  const i = t % g.nx;
  const j = Math.floor(t / g.nx);
  const dx = Math.max(g.x0 + i * g.size - x, 0, x - (g.x0 + (i + 1) * g.size));
  const dz = Math.max(g.z0 + j * g.size - z, 0, z - (g.z0 + (j + 1) * g.size));
  return Math.hypot(dx, dz);
}

export function createNearSet(grid: TileGrid, slack = grid.size * 0.3): NearSet {
  let tiles: number[] = [];
  const inSet = new Uint8Array(grid.nx * grid.nz);
  return {
    get tiles() {
      return tiles;
    },
    update(x, z, radius) {
      let changed = false;
      if (radius <= 0) {
        if (tiles.length === 0) return false;
        inSet.fill(0);
        tiles = [];
        return true;
      }
      // Only tiles within reach of the outer edge can be in or come in.
      const reach = radius + slack;
      const i0 = Math.max(0, Math.floor((x - reach - grid.x0) / grid.size));
      const i1 = Math.min(grid.nx - 1, Math.floor((x + reach - grid.x0) / grid.size));
      const j0 = Math.max(0, Math.floor((z - reach - grid.z0) / grid.size));
      const j1 = Math.min(grid.nz - 1, Math.floor((z + reach - grid.z0) / grid.size));
      const next: number[] = [];
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const t = j * grid.nx + i;
          const d = tileDistance(grid, t, x, z);
          if (d <= radius || (inSet[t] && d <= reach)) next.push(t);
        }
      }
      if (next.length !== tiles.length || next.some((t, k) => t !== tiles[k])) changed = true;
      if (changed) {
        inSet.fill(0);
        for (const t of next) inSet[t] = 1;
        tiles = next;
      }
      return changed;
    },
  };
}

/**
 * Copies the index ranges of `tiles` to the front of `out` and returns how many indices that is.
 * `out` must be at least as long as all the tiles' ranges together (the whole index list is enough).
 */
export function gatherIndices(indices: Uint32Array, tileStart: Uint32Array, tiles: readonly number[], out: Uint32Array): number {
  let n = 0;
  for (const t of tiles) {
    const part = indices.subarray(tileStart[t], tileStart[t + 1]);
    out.set(part, n);
    n += part.length;
  }
  return n;
}
