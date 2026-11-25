/**
 * Buildings: OSM footprints -> simplified rings, heights from LiDAR (DSM - DEM) with OSM fallbacks,
 * encoded to buildings.bin.gz. See docs/PLAN.md for the rules.
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import {
  encodeBuildings,
  ringSignedAreaNorthUp,
  sampleTerrain,
  type BuildingRecord,
  type TerrainGrid,
} from '../../src/shared/mapFormat';
import { BOUNDS, PUBLIC_MAP_DIR } from '../config';
import { writeGz } from '../lib/io';
import {
  distToRing,
  dropCollinear,
  pointInPolygon,
  pointInRing,
  reverseRing,
  ringBBox,
  ringCentroid,
  ringPerimeter,
  signedArea,
  simplifyRing,
} from '../lib/geom';
import { loadOsm, polygonsOf, type OsmElement, type Tags } from '../lib/osm';
import { WORK, ensure } from '../lib/paths';
import { median, rng } from '../lib/raster';
import { pickStyle } from '../lib/style';
import { loadLandmarks } from './landmarks';
import { createCanvas } from '@napi-rs/canvas';
import { DEBUG_DIR } from '../lib/paths';
import { polyPath } from './ground';
import { loadMosaic, MW, toPx, type Mosaic } from './mosaic';
import { loadTerrain } from './terrain';

export type HeightSource = 'lidar' | 'tagOverLidar' | 'levelsOverLidar' | 'tag' | 'levels' | 'default';
export const SOURCE_CODES: HeightSource[] = ['lidar', 'tagOverLidar', 'levelsOverLidar', 'tag', 'levels', 'default'];

interface Cand {
  id: number;
  tags: Tags;
  /** Outer first. Quantised to 0.25 m, outer CCW north-up, holes CW. */
  rings: number[][];
  area: number;
  cx: number;
  cz: number;
  minHeight: number;
  isPart: boolean;
}

export interface BuildingsReport {
  osmBuildings: number;
  osmParts: number;
  partsReplacingBuildings: number;
  excluded: Record<string, number>;
  kept: number;
  count: number;
  sources: Record<HeightSource, number>;
  sourcePct: Record<HeightSource, number>;
  lidarPct: number;
  shift: { bestDE: number; bestDN: number; magnitudeM: number; baseMean: number; bestMean: number; improvement: number; applied: boolean; sampled: number };
  minAreaLow: number;
  gzBytes: number;
  medianHeight: number;
  maxHeight: number;
  tallest: { height: number; x: number; z: number };
  budgetIterations: number;
  simplifiedRedone: number;
}

const MAX_COUNT = 33_000;
const Q = 0.25;
const q = (v: number) => Math.round(v / Q) * Q;

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return undefined;
  const v = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
}

function polyArea(rings: number[][]): number {
  let a = Math.abs(signedArea(rings[0]));
  for (let i = 1; i < rings.length; i++) a -= Math.abs(signedArea(rings[i]));
  return a;
}

function quantise(ring: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < ring.length; i += 2) {
    const x = q(ring[i]), z = q(ring[i + 1]);
    const n = out.length;
    if (n >= 2 && out[n - 2] === x && out[n - 1] === z) continue;
    out.push(x, z);
  }
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out;
}

/** DP at 0.75 m then near-collinear removal; redo at 0.3 m if the area moves more than 15%. */
function simplifyRings(rings: number[][], stats: { redone: number }): number[][] | null {
  const run = (eps: number) => rings.map((r) => dropCollinear(simplifyRing(r, eps), 8));
  const area0 = Math.abs(signedArea(rings[0]));
  let out = run(0.75);
  const ok = (rs: number[][]) => rs[0].length >= 6 && Math.abs(Math.abs(signedArea(rs[0])) - area0) <= 0.15 * area0;
  if (!ok(out)) {
    stats.redone++;
    out = run(0.3);
    if (!ok(out)) out = rings.map((r) => r.slice());
  }
  const keep = [out[0]];
  for (let i = 1; i < out.length; i++) if (out[i].length >= 6 && Math.abs(signedArea(out[i])) > 0.5) keep.push(out[i]);
  return keep;
}

function orient(rings: number[][]): number[][] {
  return rings.map((r, i) => {
    const a = ringSignedAreaNorthUp(r);
    const wantPositive = i === 0;
    return (a > 0) === wantPositive ? r : reverseRing(r);
  });
}

/* --------------------------------------------------------------- LiDAR sampling */

interface Raster {
  /** Mosaic pixel indices of all pixel centres inside the footprint, and the inset subset. */
  all: Int32Array;
  inset: Int32Array;
}

function rasterise(rings: number[][], sky: { x: number; z: number }): Raster {
  const [x0, z0, x1, z1] = ringBBox(rings[0]);
  const [c0f, r0f] = toPx(x0, z0);
  const [c1f, r1f] = toPx(x1, z1);
  const c0 = Math.max(0, Math.floor(c0f)), c1 = Math.min(MW - 1, Math.ceil(c1f));
  const r0 = Math.max(0, Math.floor(r0f)), r1 = Math.min(7999, Math.ceil(r1f));
  const area = polyArea(rings);
  const perim = ringPerimeter(rings[0]);
  const thickness = perim > 0 ? (2 * area) / perim : 0;
  const inset = thickness < 6 ? 0.5 : 1;
  const all: number[] = [];
  const ins: number[] = [];
  const offX = BOUNDS.minX, offZ = BOUNDS.minZ;
  for (let r = r0; r <= r1; r++) {
    const z = offZ + r + 0.5;
    for (let c = c0; c <= c1; c++) {
      const x = offX + c + 0.5;
      if (!pointInPolygon(x, z, rings)) continue;
      if (Math.hypot(x - sky.x, z - sky.z) < 25) continue;
      const idx = r * MW + c;
      all.push(idx);
      let d = distToRing(x, z, rings[0]);
      for (let k = 1; k < rings.length && d >= inset; k++) d = Math.min(d, distToRing(x, z, rings[k]));
      if (d >= inset) ins.push(idx);
    }
  }
  return { all: Int32Array.from(all), inset: Int32Array.from(ins) };
}

function medianAt(m: Mosaic, idx: Int32Array, dc = 0, dr = 0): { v: number; n: number } {
  const vals: number[] = [];
  for (let i = 0; i < idx.length; i++) {
    let p = idx[i];
    if (dc || dr) {
      const c = (p % MW) + dc, r = Math.floor(p / MW) + dr;
      if (c < 0 || c >= MW || r < 0 || r >= m.h) continue;
      p = r * MW + c;
    }
    const v = m.data[p];
    if (Number.isFinite(v)) vals.push(v);
  }
  return { v: vals.length ? median(vals) : NaN, n: vals.length };
}

/* -------------------------------------------------------------------- classes */

const SMALL_TYPES = new Set(['garage', 'garages', 'shed', 'carport', 'hut', 'greenhouse', 'kiosk', 'roof', 'container']);

function defaultHeight(t: string): number {
  if (t === 'house' || t === 'detached' || t === 'semidetached_house' || t === 'terrace' || t === 'residential' || t === 'bungalow') return 6;
  if (t === 'garage' || t === 'garages' || t === 'shed' || t === 'carport' || t === 'roof' || t === 'hut') return 3;
  if (t === 'apartments' || t === 'dormitory') return 15;
  if (t === 'commercial' || t === 'office' || t === 'retail' || t === 'hotel') return 12;
  if (t === 'industrial' || t === 'warehouse' || t === 'factory') return 8;
  if (t === 'school' || t === 'kindergarten') return 8;
  return 7;
}

/* ---------------------------------------------------------------------- build */

export async function buildBuildings() {
  const t0 = Date.now();
  const osm = loadOsm('buildings').elements;
  const dem = await loadMosaic('dem');
  const dsm = await loadMosaic('dsm');
  const terrain: TerrainGrid = loadTerrain();
  const sky = loadLandmarks().landmarks.skyTower;
  const excluded: Record<string, number> = {};
  const exclude = (why: string) => { excluded[why] = (excluded[why] ?? 0) + 1; };
  const stats = { redone: 0 };

  // ---- parse
  interface Raw { id: number; tags: Tags; polys: number[][][] }
  const raws: Raw[] = [];
  const parts: Raw[] = [];
  for (const el of osm as OsmElement[]) {
    const tags = el.tags ?? {};
    const isB = !!tags.building;
    const isP = !!tags['building:part'];
    if (!isB && !isP) continue;
    for (const p of polygonsOf(el)) (isB ? raws : parts).push({ id: el.id, tags, polys: [p.rings] });
  }
  const osmBuildings = raws.length;
  const osmParts = parts.length;

  // ---- building:part replacement
  const cell = 100;
  const pIndex = new Map<string, number[]>();
  const pInfo = parts.map((p, i) => {
    const [cx, cz] = ringCentroid(p.polys[0][0]);
    const k = `${Math.floor(cx / cell)},${Math.floor(cz / cell)}`;
    const l = pIndex.get(k);
    if (l) l.push(i);
    else pIndex.set(k, [i]);
    return { cx, cz, area: Math.abs(signedArea(p.polys[0][0])) };
  });
  const claimed = new Uint8Array(parts.length);
  const flat: Raw[] = [];
  let replaced = 0;
  for (const b of raws) {
    const outer = b.polys[0][0];
    const [bx0, bz0, bx1, bz1] = ringBBox(outer);
    const inside: number[] = [];
    for (let gx = Math.floor(bx0 / cell); gx <= Math.floor(bx1 / cell); gx++) {
      for (let gz = Math.floor(bz0 / cell); gz <= Math.floor(bz1 / cell); gz++) {
        for (const i of pIndex.get(`${gx},${gz}`) ?? []) {
          if (claimed[i]) continue;
          if (pointInRing(pInfo[i].cx, pInfo[i].cz, outer)) inside.push(i);
        }
      }
    }
    const bArea = Math.abs(signedArea(outer));
    const pArea = inside.reduce((s, i) => s + pInfo[i].area, 0);
    if (inside.length && pArea >= 0.4 * bArea) {
      replaced++;
      for (const i of inside) {
        claimed[i] = 1;
        const pt = parts[i];
        const tags: Tags = { ...b.tags, ...pt.tags };
        // A part keeps only its own height information.
        for (const k of ['height', 'building:levels', 'min_height']) {
          if (pt.tags[k] === undefined) delete tags[k];
        }
        flat.push({ id: pt.id, tags, polys: pt.polys });
      }
    } else {
      flat.push(b);
    }
  }
  parts.forEach((p, i) => { if (!claimed[i]) flat.push({ id: p.id, tags: { ...p.tags, building: p.tags.building ?? 'yes' }, polys: p.polys }); });

  // ---- filter, simplify, orient
  const cands: Cand[] = [];
  for (const b of flat) {
    const type = b.tags.building ?? 'yes';
    for (const rings0 of b.polys) {
      if (['no', 'ruins', 'bridge'].includes(type) || b.tags.man_made === 'bridge') { exclude('type'); continue; }
      const qOuter = quantise(rings0[0]);
      if (qOuter.length < 6) { exclude('degenerate'); continue; }
      let rings = [qOuter, ...rings0.slice(1).map(quantise).filter((r) => r.length >= 6)];
      const [cx, cz] = ringCentroid(rings[0]);
      if (cx < BOUNDS.minX || cx > BOUNDS.maxX || cz < BOUNDS.minZ || cz > BOUNDS.maxZ) { exclude('outside'); continue; }
      if (Math.hypot(cx - sky.x, cz - sky.z) < 25) { exclude('skyTower'); continue; }
      const area0 = polyArea(rings);
      if (area0 < 15) { exclude('area<15'); continue; }
      if (SMALL_TYPES.has(type) && area0 < 40) { exclude('small type'); continue; }
      const simp = simplifyRings(rings, stats);
      if (!simp || simp[0].length < 6) { exclude('degenerate'); continue; }
      rings = orient(simp);
      const [x0, z0, x1, z1] = ringBBox(rings[0]);
      if (x0 < BOUNDS.minX || x1 > BOUNDS.maxX || z0 < BOUNDS.minZ || z1 > BOUNDS.maxZ) { exclude('vertex outside'); continue; }
      const area = polyArea(rings);
      if (area < 5) { exclude('degenerate'); continue; }
      cands.push({
        id: b.id, tags: b.tags, rings, area, cx, cz,
        minHeight: num(b.tags.min_height) ?? 0,
        isPart: !!b.tags['building:part'],
      });
    }
  }
  console.log(`buildings: ${osmBuildings} OSM buildings + ${osmParts} parts (${replaced} replaced by parts) -> ${cands.length} candidates`, excluded);

  // ---- global shift test
  const rand = rng(12345);
  const pool = cands.filter((c) => c.area >= 100 && c.area <= 2000 && !c.isPart);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const sample = pool.slice(0, 2000).map((c) => {
    const rs = rasterise(c.rings, sky);
    return { rs, ground: medianAt(dem, rs.all).v };
  });
  const meanFor = (dc: number, dr: number) => {
    let s = 0, n = 0;
    for (const { rs, ground } of sample) {
      if (rs.inset.length < 4 || !Number.isFinite(ground)) continue;
      const m = medianAt(dsm, rs.inset, dc, dr);
      if (m.n < 4) continue;
      const h = m.v - ground;
      if (h < 2 || h > 250) continue;
      s += h; n++;
    }
    return n ? s / n : 0;
  };
  const baseMean = meanFor(0, 0);
  let best = { dc: 0, dr: 0, mean: baseMean };
  for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
    if (!dc && !dr) continue;
    const m = meanFor(dc, dr);
    if (m > best.mean) best = { dc, dr, mean: m };
  }
  const mag = Math.hypot(best.dc, best.dr);
  const improvement = baseMean > 0 ? best.mean / baseMean - 1 : 0;
  const applied = mag >= 1.5 && improvement > 0.05;
  const shift = { bestDE: best.dc, bestDN: -best.dr, magnitudeM: mag, baseMean, bestMean: best.mean, improvement, applied, sampled: sample.length };
  console.log(`buildings: shift test best dE ${shift.bestDE} dN ${shift.bestDN} (${mag.toFixed(2)} m), mean ${baseMean.toFixed(2)} -> ${best.mean.toFixed(2)} (${(improvement * 100).toFixed(2)}%), applied: ${applied}`);
  const sdc = applied ? best.dc : 0, sdr = applied ? best.dr : 0;

  // ---- heights
  interface Done extends Cand { h: number; source: HeightSource; groundRef: number }
  const done: Done[] = [];
  const sources: Record<HeightSource, number> = { lidar: 0, tagOverLidar: 0, levelsOverLidar: 0, tag: 0, levels: 0, default: 0 };
  for (const c of cands) {
    const rs = rasterise(c.rings, sky);
    const g = medianAt(dem, rs.all);
    const s = medianAt(dsm, rs.inset, sdc, sdr);
    const type = c.tags.building ?? 'yes';
    const tagH = num(c.tags.height);
    const lv = num(c.tags['building:levels']);
    const lvH = lv !== undefined && lv > 0 ? lv * 3.2 : undefined;
    const lidarH = s.n >= 4 && Number.isFinite(g.v) ? s.v - g.v : NaN;
    const lidarOk = Number.isFinite(lidarH) && lidarH >= 2 && lidarH <= 250;
    let h: number;
    let source: HeightSource;
    if (lidarOk) {
      if (tagH !== undefined && tagH > 0 && lidarH < 0.5 * tagH) { h = tagH; source = 'tagOverLidar'; }
      else if (lvH !== undefined && lidarH > 2 * lvH + 10) { h = lvH + 1; source = 'levelsOverLidar'; }
      else { h = lidarH; source = 'lidar'; }
    } else if (tagH !== undefined && tagH > 0) { h = tagH; source = 'tag'; }
    else if (lvH !== undefined) { h = lvH + 1; source = 'levels'; }
    else { h = defaultHeight(type); source = 'default'; }
    sources[source]++;
    done.push({ ...c, h, source, groundRef: g.v });
  }
  console.log('buildings: height sources', sources, `(${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // ---- base/top, style, ordering
  interface Out { rec: BuildingRecord; src: HeightSource; h: number; area: number; cx: number; cz: number; chunk: number; morton: number }
  const toOut = (d: Done): Out => {
    const outer = d.rings[0];
    let minT = Infinity, maxT = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      const t = sampleTerrain(terrain, outer[i], outer[i + 1]);
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    const tc = sampleTerrain(terrain, d.cx, d.cz);
    let baseY = minT - 2;
    let topY = Math.max(tc + d.h, maxT + 2.5);
    if (d.minHeight > 0 && Number.isFinite(d.groundRef)) {
      baseY = d.groundRef + d.minHeight;
      topY = Math.max(topY, baseY + 1);
    }
    const style = pickStyle(d.id, d.tags.building ?? 'yes', d.h, d.tags);
    const lx = d.cx - BOUNDS.minX, lz = d.cz - BOUNDS.minZ;
    const gx = Math.floor(lx / 1000), gz = Math.floor(lz / 1000);
    return {
      rec: { rings: d.rings, baseY, topY, style },
      src: d.source, h: topY - tc, area: d.area, cx: d.cx, cz: d.cz,
      chunk: gz * 10 + gx,
      morton: morton(Math.floor(((lx % 1000) / 1000) * 1023), Math.floor(((lz % 1000) / 1000) * 1023)),
    };
  };
  const all = done.map(toOut);

  // ---- budget loop on the gzipped size
  let minAreaLow = 15;
  let iterations = 0;
  let chosen: Out[] = [];
  let bytes: Uint8Array = new Uint8Array();
  for (;;) {
    chosen = all
      .filter((o) => !(o.h < 6 && o.area < minAreaLow))
      .sort((a, b) => a.chunk - b.chunk || a.morton - b.morton);
    bytes = encodeBuildings(chosen.map((o) => o.rec));
    const gz = gzipSync(bytes, { level: 9 }).byteLength;
    // The plan expects ~28-32k buildings; OSM now has more, so the same loop also enforces a count cap.
    if (gz <= 800 * 1024 && chosen.length <= MAX_COUNT) break;
    minAreaLow += 10;
    iterations++;
    if (minAreaLow > 400) throw new Error('buildings: cannot fit the 800 KB budget');
  }
  const entry = writeGz(resolve(PUBLIC_MAP_DIR, 'buildings.bin.gz'), bytes);

  const heights = chosen.map((o) => o.h).sort((a, b) => a - b);
  const tallestO = chosen.reduce((m, o) => (o.rec.topY - o.rec.baseY > m.rec.topY - m.rec.baseY ? o : m), chosen[0]);
  const finalSources: Record<HeightSource, number> = { lidar: 0, tagOverLidar: 0, levelsOverLidar: 0, tag: 0, levels: 0, default: 0 };
  for (const o of chosen) finalSources[o.src]++;
  const pct = Object.fromEntries(SOURCE_CODES.map((k) => [k, (100 * finalSources[k]) / chosen.length])) as Record<HeightSource, number>;
  const report: BuildingsReport = {
    osmBuildings, osmParts, partsReplacingBuildings: replaced, excluded, kept: cands.length, count: chosen.length,
    sources: finalSources, sourcePct: pct, lidarPct: pct.lidar, shift, minAreaLow, gzBytes: entry.bytes,
    medianHeight: heights[Math.floor(heights.length / 2)],
    maxHeight: Math.max(...chosen.map((o) => o.rec.topY - o.rec.baseY)),
    tallest: { height: tallestO.h, x: tallestO.cx, z: tallestO.cz },
    budgetIterations: iterations, simplifiedRedone: stats.redone,
  };
  ensure(WORK);
  writeFileSync(resolve(WORK, 'buildings.json'), JSON.stringify(report, null, 1));
  // Per-building info for debug maps, in file order.
  writeFileSync(resolve(WORK, 'buildings-debug.json'), JSON.stringify(chosen.map((o) => [SOURCE_CODES.indexOf(o.src), Math.round(o.h * 10) / 10])));
  writeDebugMaps(chosen);
  console.log(`buildings: ${chosen.length} buildings, ${(entry.bytes / 1024).toFixed(0)} KB gz, median ${report.medianHeight.toFixed(1)} m, tallest ${report.tallest.height.toFixed(0)} m, LiDAR ${report.lidarPct.toFixed(1)}%, minAreaLow ${minAreaLow}`);
  return report;
}

function morton(x: number, y: number): number {
  let r = 0;
  for (let i = 0; i < 10; i++) r |= ((x >> i) & 1) << (2 * i) | ((y >> i) & 1) << (2 * i + 1);
  return r >>> 0;
}

function writeDebugMaps(chosen: { rec: BuildingRecord; src: HeightSource; h: number }[]) {
  const mpp = 4;
  const w = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / mpp), h = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / mpp);
  const srcColor: Record<HeightSource, string> = { lidar: '#3fa34d', tagOverLidar: '#f28c28', levelsOverLidar: '#f2d028', tag: '#3a7bd5', levels: '#38c6c6', default: '#d7263d' };
  const heat = (m: number) => {
    const t = Math.min(1, m / 60);
    const hue = 240 - 240 * t;
    return `hsl(${hue}, 85%, ${m > 60 ? 80 : 50}%)`;
  };
  ensure(DEBUG_DIR);
  for (const [name, colour] of [['heights', (o: (typeof chosen)[number]) => heat(o.h)], ['height-sources', (o: (typeof chosen)[number]) => srcColor[o.src]]] as const) {
    const cv = createCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#20262b';
    ctx.fillRect(0, 0, w, h);
    for (const o of chosen) {
      ctx.fillStyle = colour(o);
      ctx.beginPath();
      polyPath(ctx, o.rec.rings, mpp);
      ctx.fill('evenodd');
    }
    writeFileSync(resolve(DEBUG_DIR, `${name}.png`), cv.toBuffer('image/png'));
  }
}
