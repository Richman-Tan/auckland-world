/** 20 m terrain grid: area-mean of the 1 m DEM per vertex, with shoreline and sea rules. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeTerrain, encodeTerrain, type TerrainGrid } from '../../src/shared/mapFormat';
import { BOUNDS, PUBLIC_MAP_DIR, TERRAIN_CELL } from '../config';
import { writeGz } from '../lib/io';
import { loadMosaic, MH, MW, pxX, pxZ } from './mosaic';
import { terrainWaterVotes, type WaterMask } from './water';

export const T_COLS = Math.round((BOUNDS.maxX - BOUNDS.minX) / TERRAIN_CELL) + 1; // 361
export const T_ROWS = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / TERRAIN_CELL) + 1; // 401

export async function buildTerrain(mask: WaterMask) {
  const dem = await loadMosaic('dem');
  const cols = T_COLS, rows = T_ROWS, cell = TERRAIN_CELL;
  const sum = new Float64Array(cols * rows);
  const cnt = new Uint32Array(cols * rows);
  for (let r = 0; r < MH; r++) {
    const vr = Math.min(rows - 1, Math.max(0, Math.round((pxZ(r) - BOUNDS.minZ) / cell)));
    for (let c = 0; c < MW; c++) {
      const v = dem.data[r * MW + c];
      if (!Number.isFinite(v)) continue;
      const vc = Math.min(cols - 1, Math.max(0, Math.round((pxX(c) - BOUNDS.minX) / cell)));
      sum[vr * cols + vc] += v;
      cnt[vr * cols + vc]++;
    }
  }
  const sea = terrainWaterVotes(mask, cols, rows, cell);
  const h = new Float32Array(cols * rows);
  const hole = new Uint8Array(cols * rows);
  for (let i = 0; i < h.length; i++) {
    if (cnt[i] > 0) h[i] = sum[i] / cnt[i];
    else hole[i] = 1;
  }
  const near = (c: number, r: number, rad: number, pred: (i: number) => boolean) => {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        if (pred(rr * cols + cc)) return true;
      }
    }
    return false;
  };
  const isLand = (i: number) => sea[i] === 0;
  // Land holes: wharves get 2.5, anything else takes the nearest valid value.
  const filled = new Uint8Array(cols * rows);
  for (let i = 0; i < h.length; i++) {
    if (!hole[i] || sea[i]) continue;
    const c = i % cols, r = (i - c) / cols;
    if (near(c, r, 2, (j) => sea[j] === 1)) { h[i] = 2.5; filled[i] = 1; }
  }
  // Nearest-valid fill for remaining holes (multi-source BFS over valid cells).
  let frontier: number[] = [];
  const valid = new Uint8Array(cols * rows);
  for (let i = 0; i < h.length; i++) if ((!hole[i] || filled[i]) && !sea[i]) { valid[i] = 1; frontier.push(i); }
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const c = i % cols, r = (i - c) / cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (valid[j] || sea[j]) continue;
        h[j] = h[i];
        valid[j] = 1;
        next.push(j);
      }
    }
    frontier = next;
  }
  const out = new Float32Array(h);
  let shoreRaised = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const landWithin1 = near(c, r, 1, isLand);
      if (sea[i]) {
        if (landWithin1) { out[i] = Math.max(h[i], 0.6); shoreRaised++; }
        else if (!near(c, r, 2, isLand)) out[i] = -3;
        else out[i] = -1.5;
      } else if (h[i] < 0.6) {
        out[i] = 0.6;
        shoreRaised++;
      }
    }
  }
  const grid: TerrainGrid = { cols, rows, cell, x0: BOUNDS.minX, z0: BOUNDS.minZ, minH: 0, maxH: 0, heights: out };
  const bytes = encodeTerrain(grid);
  const entry = writeGz(resolve(PUBLIC_MAP_DIR, 'terrain.bin.gz'), bytes);
  const back = decodeTerrain(bytes);
  console.log(`terrain: ${cols}x${rows}, ${back.minH.toFixed(1)}..${back.maxH.toFixed(1)} m, ${(entry.bytes / 1024).toFixed(0)} KB gz, shore-clamped ${shoreRaised}`);
  return back;
}

export function loadTerrain(): TerrainGrid {
  return decodeTerrain(new Uint8Array(gunzipSync(readFileSync(resolve(PUBLIC_MAP_DIR, 'terrain.bin.gz')))));
}
