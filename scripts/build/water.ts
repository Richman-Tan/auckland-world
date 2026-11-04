/**
 * Sea mask. The OSM coastline is drawn as 1-px barrier lines on a 1.5 m grid and the sea is flood-filled
 * from fixed seed points; piers are then turned back into land. The DEM is used only to validate.
 */
import { createCanvas } from '@napi-rs/canvas';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BOUNDS } from '../config';
import { lonLatToLocal } from '../lib/geo';
import { pointInRing, ringBBox, distToSegment } from '../lib/geom';
import { geomToLocal, loadOsm, polygonsOf, type OsmElement } from '../lib/osm';
import { DEBUG_DIR, WORK, ensure } from '../lib/paths';
import { bresenham, floodFill4, median } from '../lib/raster';
import { loadMosaic, toPx } from './mosaic';

export const WATER_MPP = 1.5;
export const WW = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / WATER_MPP); // 4800
export const WH = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / WATER_MPP); // 5334

export const SEA_SEEDS: [string, number, number][] = [
  ['mid-harbour', -36.836, 174.76],
  // The spec's (-36.840, 174.745) sits on reclaimed marina land (DEM 2.4 m, enclosed by coastline), so it floods the land.
  ['Westhaven / St Marys Bay', -36.8375, 174.7445],
  ['off Herne Bay', -36.835, 174.73],
  // The spec's (-36.853, 174.792) is Parnell hillside (DEM 34 m); this point is in Hobson Bay water.
  ['Hobson Bay', -36.8505, 174.8],
  ['off Northcote', -36.822, 174.755],
];

export const KNOWN_LAND: [string, number, number][] = [
  ['Sky Tower', -36.84846, 174.76221],
  ['Albert Park', -36.8512, 174.7683],
  ['Mt Eden', -36.8767, 174.7643],
  ['Mt Victoria (Devonport)', -36.82646, 174.7985],
  ['Northcote Point', -36.8251, 174.7486],
];
export const KNOWN_WATER: [string, number, number][] = [
  ['mid-harbour', -36.836, 174.76],
  ['off Wynyard', -36.8365, 174.7575],
];

const px = (x: number) => (x - BOUNDS.minX) / WATER_MPP;
const pz = (z: number) => (z - BOUNDS.minZ) / WATER_MPP;

export interface WaterMask {
  /** 1 = sea, 0 = land. 1.5 m cells, WW x WH, row 0 = north edge. */
  data: Uint8Array;
}

export function isSea(m: WaterMask, x: number, z: number): boolean {
  const c = Math.floor(px(x));
  const r = Math.floor(pz(z));
  if (c < 0 || r < 0 || c >= WW || r >= WH) return false;
  return m.data[r * WW + c] === 1;
}

/** Majority vote down to `factor` x `factor` blocks (factor 2 -> 3 m). Ties go to water. */
export function downsampleMajority(m: WaterMask, factor: number): { data: Uint8Array; w: number; h: number } {
  const w = Math.ceil(WW / factor);
  const h = Math.ceil(WH / factor);
  const out = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let n = 0, wet = 0;
      for (let dr = 0; dr < factor; dr++) {
        const rr = r * factor + dr;
        if (rr >= WH) continue;
        for (let dc = 0; dc < factor; dc++) {
          const cc = c * factor + dc;
          if (cc >= WW) continue;
          n++;
          wet += m.data[rr * WW + cc];
        }
      }
      out[r * w + c] = wet * 2 >= n ? 1 : 0;
    }
  }
  return { data: out, w, h };
}

/** Sea mask sampled on the terrain vertex grid: each 1.5 m cell votes for its nearest vertex. */
export function terrainWaterVotes(m: WaterMask, cols: number, rows: number, cell: number): Uint8Array {
  const wet = new Uint32Array(cols * rows);
  const tot = new Uint32Array(cols * rows);
  for (let r = 0; r < WH; r++) {
    const z = BOUNDS.minZ + (r + 0.5) * WATER_MPP;
    const vr = Math.min(rows - 1, Math.max(0, Math.round((z - BOUNDS.minZ) / cell)));
    for (let c = 0; c < WW; c++) {
      const x = BOUNDS.minX + (c + 0.5) * WATER_MPP;
      const vc = Math.min(cols - 1, Math.max(0, Math.round((x - BOUNDS.minX) / cell)));
      const i = vr * cols + vc;
      tot[i]++;
      wet[i] += m.data[r * WW + c];
    }
  }
  const out = new Uint8Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = wet[i] * 2 > tot[i] ? 1 : 0;
  return out;
}

function fillPolygon(mask: Uint8Array, rings: number[][], val: number) {
  const [x0, z0, x1, z1] = ringBBox(rings[0]);
  const c0 = Math.max(0, Math.floor(px(x0))), c1 = Math.min(WW - 1, Math.ceil(px(x1)));
  const r0 = Math.max(0, Math.floor(pz(z0))), r1 = Math.min(WH - 1, Math.ceil(pz(z1)));
  for (let r = r0; r <= r1; r++) {
    const z = BOUNDS.minZ + (r + 0.5) * WATER_MPP;
    for (let c = c0; c <= c1; c++) {
      const x = BOUNDS.minX + (c + 0.5) * WATER_MPP;
      if (!pointInRing(x, z, rings[0])) continue;
      let hole = false;
      for (let k = 1; k < rings.length && !hole; k++) if (pointInRing(x, z, rings[k])) hole = true;
      if (!hole) mask[r * WW + c] = val;
    }
  }
}

function thickLine(mask: Uint8Array, line: number[], halfWidthM: number, val: number) {
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
    const c0 = Math.max(0, Math.floor(px(Math.min(ax, bx) - halfWidthM))), c1 = Math.min(WW - 1, Math.ceil(px(Math.max(ax, bx) + halfWidthM)));
    const r0 = Math.max(0, Math.floor(pz(Math.min(az, bz) - halfWidthM))), r1 = Math.min(WH - 1, Math.ceil(pz(Math.max(az, bz) + halfWidthM)));
    for (let r = r0; r <= r1; r++) {
      const z = BOUNDS.minZ + (r + 0.5) * WATER_MPP;
      for (let c = c0; c <= c1; c++) {
        const x = BOUNDS.minX + (c + 0.5) * WATER_MPP;
        if (distToSegment(x, z, ax, az, bx, bz) <= halfWidthM) mask[r * WW + c] = val;
      }
    }
  }
}

export interface WaterReport {
  seedRegions: { name: string; filled: number; alreadyFilled: boolean }[];
  waterFraction: number;
  coastSegmentsChecked: number;
  /** Fraction of coast segments whose right-hand side is flood-filled sea (validates closure and orientation). */
  coastAgreement: number;
  coastAgreementAfterPiers: number;
  knownLand: { name: string; ok: boolean }[];
  knownWater: { name: string; ok: boolean }[];
  medianDemOverWater: number;
  waterAboveFiveM: number;
  piersAdded: number;
}

/** Coastline ways as local polylines. */
export function coastlines(): number[][] {
  const out: number[][] = [];
  for (const el of loadOsm('water').elements) {
    if (el.type === 'way' && el.tags?.natural === 'coastline') out.push(geomToLocal(el.geometry));
  }
  return out;
}

export async function buildWater(): Promise<{ mask: WaterMask; report: WaterReport }> {
  const water = loadOsm('water');
  const lines = coastlines();
  const grid = new Uint8Array(WW * WH); // 1 = barrier, 2 = sea
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      bresenham(grid, WW, WH, Math.floor(px(l[i])), Math.floor(pz(l[i + 1])), Math.floor(px(l[i + 2])), Math.floor(pz(l[i + 3])), 1);
    }
  }
  const seedRegions: WaterReport['seedRegions'] = [];
  for (const [name, lat, lon] of SEA_SEEDS) {
    const { x, z } = lonLatToLocal(lon, lat);
    const c = Math.floor(px(x)), r = Math.floor(pz(z));
    if (c < 0 || r < 0 || c >= WW || r >= WH) throw new Error(`Sea seed ${name} is outside the world`);
    const v = grid[r * WW + c];
    if (v === 1) throw new Error(`Sea seed ${name} sits on a coastline barrier cell`);
    if (v === 2) {
      seedRegions.push({ name, filled: 0, alreadyFilled: true });
      continue;
    }
    const filled = floodFill4(grid, WW, WH, c, r, 2);
    seedRegions.push({ name, filled, alreadyFilled: false });
    console.log(`water: seed ${name} filled ${filled} cells`);
  }
  const sea = new Uint8Array(WW * WH);
  for (let i = 0; i < sea.length; i++) sea[i] = grid[i] === 2 ? 1 : 0;

  // Piers back to land.
  let piersAdded = 0;
  const pierCells = new Uint8Array(WW * WH);
  for (const el of water.elements as OsmElement[]) {
    if (el.tags?.man_made !== 'pier') continue;
    const polys = polygonsOf(el);
    if (polys.length) {
      for (const p of polys) fillPolygon(pierCells, p.rings, 1);
      piersAdded++;
    } else if (el.type === 'way') {
      thickLine(pierCells, geomToLocal(el.geometry), 3, 1);
      piersAdded++;
    }
  }
  const floodOnly: WaterMask = { data: sea.slice() };
  for (let i = 0; i < sea.length; i++) if (pierCells[i]) sea[i] = 0;
  const mask: WaterMask = { data: sea };

  // ---- validation
  let wet = 0;
  for (let i = 0; i < sea.length; i++) wet += sea[i];
  const waterFraction = wet / sea.length;

  let checked = 0, agree = 0, agreeFinal = 0;
  const disagree: [number, number][] = [];
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const dx = l[i + 2] - l[i], dz = l[i + 3] - l[i + 1];
      const len = Math.hypot(dx, dz);
      if (len < 1) continue;
      const mx = (l[i] + l[i + 2]) / 2, mz = (l[i + 1] + l[i + 3]) / 2;
      // Right of travel on a north-up map is (-dz, dx) in (x, z).
      const sx = mx + (-dz / len) * 3, sz = mz + (dx / len) * 3;
      if (sx < BOUNDS.minX || sx > BOUNDS.maxX || sz < BOUNDS.minZ || sz > BOUNDS.maxZ) continue;
      checked++;
      if (isSea(floodOnly, sx, sz)) agree++;
      else if (disagree.length < 12) disagree.push([Math.round(mx), Math.round(mz)]);
      if (isSea(mask, sx, sz)) agreeFinal++;
    }
  }
  if (disagree.length) console.log('water: sample coast disagreements at (x,z):', JSON.stringify(disagree));
  const dem = await loadMosaic('dem');
  const demAtWater: number[] = [];
  let above5 = 0, nWet = 0;
  for (let r = 0; r < WH; r += 2) {
    for (let c = 0; c < WW; c += 2) {
      if (!sea[r * WW + c]) continue;
      const x = BOUNDS.minX + (c + 0.5) * WATER_MPP, z = BOUNDS.minZ + (r + 0.5) * WATER_MPP;
      const [pc, pr] = toPx(x, z);
      const v = dem.data[Math.min(dem.h - 1, Math.floor(pr)) * dem.w + Math.min(dem.w - 1, Math.floor(pc))];
      if (!Number.isFinite(v)) continue;
      nWet++;
      if (v > 5) above5++;
      if ((r + c) % 7 === 0) demAtWater.push(v);
    }
  }
  const classify = (list: [string, number, number][], want: boolean) =>
    list.map(([name, lat, lon]) => {
      const { x, z } = lonLatToLocal(lon, lat);
      return { name, ok: isSea(mask, x, z) === want };
    });
  const report: WaterReport = {
    seedRegions,
    waterFraction,
    coastSegmentsChecked: checked,
    coastAgreement: checked ? agree / checked : 0,
    coastAgreementAfterPiers: checked ? agreeFinal / checked : 0,
    knownLand: classify(KNOWN_LAND, false),
    knownWater: classify(KNOWN_WATER, true),
    medianDemOverWater: median(demAtWater),
    waterAboveFiveM: nWet ? above5 / nWet : 0,
    piersAdded,
  };
  console.log(
    `water: fraction ${(waterFraction * 100).toFixed(1)}%, coast agreement ${(report.coastAgreement * 100).toFixed(2)}% (after piers ${(report.coastAgreementAfterPiers * 100).toFixed(2)}%) of ${checked}, ` +
      `median DEM over water ${report.medianDemOverWater.toFixed(2)} m, ${(report.waterAboveFiveM * 100).toFixed(3)}% above 5 m, piers ${piersAdded}`,
  );
  const bad = [...report.knownLand, ...report.knownWater].filter((k) => !k.ok);

  await writeDebug(mask, lines);
  saveWater(mask, report);
  if (bad.length) throw new Error(`water: known points misclassified: ${bad.map((k) => k.name).join(', ')}`);
  return { mask, report };
}

export function saveWater(mask: WaterMask, report: WaterReport) {
  ensure(WORK);
  writeFileSync(resolve(WORK, 'water.u8.gz'), gzipSync(mask.data, { level: 6 }));
  writeFileSync(resolve(WORK, 'water.json'), JSON.stringify(report, null, 1));
}

export function loadWater(): { mask: WaterMask; report: WaterReport } {
  const p = resolve(WORK, 'water.u8.gz');
  if (!existsSync(p)) throw new Error('No water mask in work/: run the water stage first');
  const data = new Uint8Array(gunzipSync(readFileSync(p)));
  return { mask: { data }, report: JSON.parse(readFileSync(resolve(WORK, 'water.json'), 'utf8')) };
}

async function writeDebug(mask: WaterMask, lines: number[][]) {
  const f = 3; // 4.5 m per debug pixel
  const w = Math.ceil(WW / f), h = Math.ceil(WH / f);
  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const sea = mask.data[Math.min(WH - 1, r * f + 1) * WW + Math.min(WW - 1, c * f + 1)] === 1;
      const i = (r * w + c) * 4;
      img.data[i] = sea ? 31 : 216;
      img.data[i + 1] = sea ? 111 : 205;
      img.data[i + 2] = sea ? 120 : 178;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = '#d7263d';
  ctx.lineWidth = 1;
  for (const l of lines) {
    ctx.beginPath();
    for (let i = 0; i < l.length; i += 2) {
      const X = px(l[i]) / f, Z = pz(l[i + 1]) / f;
      if (i === 0) ctx.moveTo(X, Z);
      else ctx.lineTo(X, Z);
    }
    ctx.stroke();
  }
  for (const [name, lat, lon] of [...KNOWN_LAND, ...KNOWN_WATER, ...SEA_SEEDS]) {
    const { x, z } = lonLatToLocal(lon, lat);
    ctx.fillStyle = KNOWN_WATER.some((k) => k[0] === name) || SEA_SEEDS.some((k) => k[0] === name) ? '#ffff00' : '#ff00ff';
    ctx.fillRect(px(x) / f - 3, pz(z) / f - 3, 6, 6);
  }
  ensure(DEBUG_DIR);
  writeFileSync(resolve(DEBUG_DIR, 'water.png'), cv.toBuffer('image/png'));
}
