/** Pure terrain and outskirts mesh generation (runs in the geometry worker, testable in Node). */
import { type Bounds, type TerrainGrid, sampleTerrain } from '../shared/mapFormat';

export interface MeshArrays {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * One mesh over the terrain grid. UVs map the whole world rectangle onto the ground texture
 * (u west -> east, v north -> south, v = 0 at the top row of the image).
 * `stride` > 1 skips grid vertices (used for the low quality tier).
 */
/**
 * `waterLevel`: cells whose four corners are all below it are left out. The sea is an opaque plane
 * at that level, so they could never be seen, and on the real map they are a third of the grid.
 * The vertices stay (and keep their numbering); only the triangles go.
 */
export function buildTerrainMesh(t: TerrainGrid, bounds: Bounds, stride = 1, waterLevel = -Infinity): MeshArrays {
  const cs: number[] = [];
  for (let c = 0; c < t.cols; c += stride) cs.push(c);
  if (cs[cs.length - 1] !== t.cols - 1) cs.push(t.cols - 1);
  const rs: number[] = [];
  for (let r = 0; r < t.rows; r += stride) rs.push(r);
  if (rs[rs.length - 1] !== t.rows - 1) rs.push(t.rows - 1);
  const nc = cs.length;
  const nr = rs.length;
  const positions = new Float32Array(nc * nr * 3);
  const uvs = new Float32Array(nc * nr * 2);
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      const c = cs[i];
      const r = rs[j];
      const x = t.x0 + c * t.cell;
      const z = t.z0 + r * t.cell;
      const o = j * nc + i;
      positions[o * 3] = x;
      positions[o * 3 + 1] = t.heights[r * t.cols + c];
      positions[o * 3 + 2] = z;
      uvs[o * 2] = (x - bounds.minX) / w;
      uvs[o * 2 + 1] = (z - bounds.minZ) / d;
    }
  }
  const all = new Uint32Array((nc - 1) * (nr - 1) * 6);
  const y = (v: number) => positions[v * 3 + 1];
  let k = 0;
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      const v00 = j * nc + i;
      const v10 = v00 + 1;
      const v01 = v00 + nc;
      const v11 = v01 + 1;
      if (y(v00) < waterLevel && y(v10) < waterLevel && y(v01) < waterLevel && y(v11) < waterLevel) continue;
      const indices = all;
      // Normal up (+y): (v00, v01, v10) has u = +z, w = +x, cross.y = u.z * w.x > 0.
      if (((i + j) & 1) === 0) {
        indices[k++] = v00; indices[k++] = v01; indices[k++] = v10;
        indices[k++] = v10; indices[k++] = v01; indices[k++] = v11;
      } else {
        indices[k++] = v00; indices[k++] = v01; indices[k++] = v11;
        indices[k++] = v00; indices[k++] = v11; indices[k++] = v10;
      }
    }
  }
  return { positions, uvs, indices: all.slice(0, k) };
}

export const OUTSKIRTS_MARGIN = 4000;
export const OUTSKIRTS_DECAY = 1500;
export const OUTSKIRTS_CELL = 100;
/** Where the decayed outskirts end up: just below the water so they sink into the sea. */
export const OUTSKIRTS_FLOOR = -2;

/**
 * A ring of coarse terrain around the world rectangle. Heights continue from the nearest edge
 * value and decay to OUTSKIRTS_FLOOR over OUTSKIRTS_DECAY metres. UVs are the ground-texture
 * UVs (they leave 0..1; the shader clamps them).
 */
export function buildOutskirtsMesh(t: TerrainGrid, bounds: Bounds, waterLevel = -Infinity): MeshArrays {
  const m = OUTSKIRTS_MARGIN;
  const cell = OUTSKIRTS_CELL;
  const x0 = bounds.minX - m;
  const z0 = bounds.minZ - m;
  const nx = Math.round((bounds.maxX - bounds.minX + 2 * m) / cell);
  const nz = Math.round((bounds.maxZ - bounds.minZ + 2 * m) / cell);
  const nc = nx + 1;
  const nr = nz + 1;
  const positions = new Float32Array(nc * nr * 3);
  const uvs = new Float32Array(nc * nr * 2);
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      const cx = Math.min(Math.max(x, bounds.minX), bounds.maxX);
      const cz = Math.min(Math.max(z, bounds.minZ), bounds.maxZ);
      const out = Math.hypot(x - cx, z - cz);
      const edgeH = sampleTerrain(t, cx, cz);
      const f = Math.min(out / OUTSKIRTS_DECAY, 1);
      const s = f * f * (3 - 2 * f);
      const o = j * nc + i;
      positions[o * 3] = x;
      positions[o * 3 + 1] = edgeH + (OUTSKIRTS_FLOOR - edgeH) * s;
      positions[o * 3 + 2] = z;
      uvs[o * 2] = (x - bounds.minX) / w;
      uvs[o * 2 + 1] = (z - bounds.minZ) / d;
    }
  }
  const inside = (i: number, j: number) => {
    const xa = x0 + i * cell;
    const za = z0 + j * cell;
    return xa >= bounds.minX && xa + cell <= bounds.maxX && za >= bounds.minZ && za + cell <= bounds.maxZ;
  };
  const list: number[] = [];
  const y = (v: number) => positions[v * 3 + 1];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (inside(i, j)) continue;
      const v00 = j * nc + i;
      const v10 = v00 + 1;
      const v01 = v00 + nc;
      const v11 = v01 + 1;
      // Under the sea (most of the ring, once it has sunk to the floor): never seen, so not drawn.
      if (y(v00) < waterLevel && y(v10) < waterLevel && y(v01) < waterLevel && y(v11) < waterLevel) continue;
      list.push(v00, v01, v10, v10, v01, v11);
    }
  }
  return { positions, uvs, indices: Uint32Array.from(list) };
}
