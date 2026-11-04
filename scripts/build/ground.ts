/** Ground texture: a Skia render of OSM data under a quantised hillshade, with the sea cut out as alpha. */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeBuildings } from '../../src/shared/mapFormat';
import { hexToRgb, GROUND } from '../../src/shared/palette';
import { BOUNDS, GROUND_LO_MPP, GROUND_MPP, PUBLIC_MAP_DIR } from '../config';
import { writeFile } from '../lib/io';
import { loadOsm, polygonsOf, type Polygon } from '../lib/osm';
import { DEBUG_DIR, ensure } from '../lib/paths';
import { signedArea } from '../lib/geom';
import { loadMosaic, MW, MH } from './mosaic';
import { downsampleMajority, loadWater } from './water';

export const GW = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / GROUND_MPP); // 2400
export const GH = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / GROUND_MPP); // 2667

/* ------------------------------------------------------------------ OSM layers */

type AreaLayer = 2 | 3 | 4 | 5 | 10;
interface AreaFeature { layer: AreaLayer; color: string; polys: Polygon[]; area: number }

function classifyArea(t: Record<string, string>): { layer: AreaLayer; color: string } | null {
  const lu = t.landuse, le = t.leisure, na = t.natural, am = t.amenity;
  if (na === 'wood' || lu === 'forest') return { layer: 4, color: GROUND.wood };
  if (na === 'scrub' || na === 'heath' || na === 'wetland') return { layer: 4, color: GROUND.scrub };
  if (le === 'golf_course') return { layer: 4, color: GROUND.pitch };
  if (na === 'beach' || na === 'sand') return { layer: 5, color: GROUND.sand };
  if (na === 'bare_rock') return { layer: 5, color: GROUND.rock };
  if (le === 'pitch' || le === 'track' || le === 'stadium') return { layer: 3, color: GROUND.pitch };
  if (le === 'park' || le === 'garden' || le === 'playground' || le === 'nature_reserve' || na === 'grassland') return { layer: 3, color: GROUND.park };
  if (lu === 'grass' || lu === 'recreation_ground' || lu === 'meadow' || lu === 'village_green' || lu === 'cemetery' || lu === 'orchard' || lu === 'allotments') return { layer: 3, color: GROUND.park };
  if (lu === 'residential') return { layer: 2, color: GROUND.residential };
  if (lu === 'commercial' || lu === 'retail' || am === 'school' || am === 'university' || am === 'hospital') return { layer: 2, color: GROUND.commercial };
  if (lu === 'industrial' || lu === 'railway' || lu === 'construction' || am === 'parking') return { layer: 2, color: GROUND.industrial };
  return null;
}

let areaCache: AreaFeature[] | null = null;
export function areaFeatures(): AreaFeature[] {
  if (areaCache) return areaCache;
  const out: AreaFeature[] = [];
  for (const el of loadOsm('areas').elements) {
    if (!el.tags) continue;
    const cl = classifyArea(el.tags);
    if (!cl) continue;
    const polys = polygonsOf(el);
    if (!polys.length) continue;
    out.push({ ...cl, polys, area: polys.reduce((s, p) => s + Math.abs(signedArea(p.rings[0])), 0) });
  }
  out.sort((a, b) => b.area - a.area);
  areaCache = out;
  return out;
}

export interface Road { cls: string; width: number; line: number[]; bridge: boolean }
const ROAD_W: Record<string, number> = {
  motorway: 18, motorway_link: 9, trunk: 14, trunk_link: 8, primary: 12, primary_link: 7, secondary: 10, secondary_link: 6,
  tertiary: 9, tertiary_link: 6, residential: 7, unclassified: 7, living_street: 6, service: 4, road: 6,
};
const ROAD_ORDER = ['service', 'living_street', 'road', 'unclassified', 'residential', 'tertiary_link', 'tertiary', 'secondary_link', 'secondary', 'primary_link', 'primary', 'trunk_link', 'trunk', 'motorway_link', 'motorway'];

let roadCache: { roads: Road[]; rails: number[][] } | null = null;
export function transport() {
  if (roadCache) return roadCache;
  const roads: Road[] = [];
  const rails: number[][] = [];
  for (const el of loadOsm('transport').elements) {
    if (el.type !== 'way' || !el.tags || !el.geometry) continue;
    const t = el.tags;
    if (t.tunnel === 'yes' || t.tunnel === 'building_passage') continue;
    const line: number[] = [];
    for (const p of el.geometry) if (p) line.push(...localOf(p));
    if (t.highway && ROAD_W[t.highway] !== undefined && t.area !== 'yes') {
      roads.push({ cls: t.highway, width: ROAD_W[t.highway], line, bridge: t.bridge === 'yes' });
    } else if (t.railway && ['rail', 'light_rail', 'subway'].includes(t.railway)) {
      rails.push(line);
    }
  }
  roads.sort((a, b) => ROAD_ORDER.indexOf(a.cls) - ROAD_ORDER.indexOf(b.cls));
  roadCache = { roads, rails };
  return roadCache;
}
import { lonLatToLocal } from '../lib/geo';
function localOf(p: { lat: number; lon: number }): [number, number] {
  const { x, z } = lonLatToLocal(p.lon, p.lat);
  return [x, z];
}

export function inlandWater(): { polys: Polygon[]; lines: { line: number[]; width: number }[] } {
  const polys: Polygon[] = [];
  const lines: { line: number[]; width: number }[] = [];
  for (const el of loadOsm('water').elements) {
    const t = el.tags ?? {};
    if (t.natural === 'water') polys.push(...polygonsOf(el));
    else if (el.type === 'way' && t.waterway && el.geometry) {
      const line: number[] = [];
      for (const p of el.geometry) if (p) line.push(...localOf(p));
      lines.push({ line, width: t.waterway === 'river' ? 12 : t.waterway === 'canal' ? 8 : 3 });
    }
  }
  return { polys, lines };
}

/* ---------------------------------------------------------------------- drawing */

export function polyPath(ctx: SKRSContext2D, rings: number[][], mpp: number, dx = 0, dy = 0) {
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      const X = (r[i] - BOUNDS.minX) / mpp + dx, Y = (r[i + 1] - BOUNDS.minZ) / mpp + dy;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
  }
}

function strokeLine(ctx: SKRSContext2D, line: number[], mpp: number) {
  ctx.beginPath();
  for (let i = 0; i < line.length; i += 2) {
    const X = (line[i] - BOUNDS.minX) / mpp, Y = (line[i + 1] - BOUNDS.minZ) / mpp;
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  }
  ctx.stroke();
}

export function drawAreas(ctx: SKRSContext2D, mpp: number, layers: AreaLayer[]) {
  for (const layer of layers) {
    for (const f of areaFeatures()) {
      if (f.layer !== layer) continue;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      for (const p of f.polys) polyPath(ctx, p.rings, mpp);
      ctx.fill('evenodd');
    }
  }
}

export function drawRoads(ctx: SKRSContext2D, mpp: number, minClass: string | null, casing = true) {
  const { roads } = transport();
  const minIdx = minClass ? ROAD_ORDER.indexOf(minClass) : 0;
  const list = roads.filter((r) => ROAD_ORDER.indexOf(r.cls) >= minIdx);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (casing) {
    ctx.strokeStyle = GROUND.roadCasing;
    for (const r of list) {
      ctx.lineWidth = Math.max(1, (r.width + 1.5) / mpp);
      strokeLine(ctx, r.line, mpp);
    }
  }
  for (const r of list) {
    ctx.strokeStyle = r.cls.startsWith('motorway') ? GROUND.motorway : GROUND.road;
    ctx.lineWidth = Math.max(0.8, r.width / mpp);
    strokeLine(ctx, r.line, mpp);
  }
}

/* -------------------------------------------------------------------- hillshade */

export async function demAt3m(): Promise<Float32Array> {
  const dem = await loadMosaic('dem');
  const sum = new Float64Array(GW * GH);
  const cnt = new Uint16Array(GW * GH);
  const f = GROUND_MPP;
  for (let r = 0; r < MH; r++) {
    const gr = Math.min(GH - 1, Math.floor(r / f));
    for (let c = 0; c < MW; c++) {
      const v = dem.data[r * MW + c];
      if (!Number.isFinite(v)) continue;
      const gi = gr * GW + Math.min(GW - 1, Math.floor(c / f));
      sum[gi] += v;
      cnt[gi]++;
    }
  }
  const out = new Float32Array(GW * GH);
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] ? sum[i] / cnt[i] : NaN;
  // Fill NaNs with a neighbour so Horn stays defined.
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = i > 0 ? out[i - 1] : 0;
  return out;
}

/** Quantised Horn hillshade (azimuth 315, altitude 40): 4 bands, value in (0, 1]; flat ground = 0.8. */
export function hillshadeBands(dem: Float32Array, w: number, h: number, cs: number): Uint8Array {
  const az = (315 * Math.PI) / 180, alt = (40 * Math.PI) / 180;
  const out = new Uint8Array(w * h);
  const at = (c: number, r: number) => dem[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const a = at(c - 1, r - 1), b = at(c, r - 1), cc = at(c + 1, r - 1);
      const d = at(c - 1, r), f = at(c + 1, r);
      const g = at(c - 1, r + 1), hh = at(c, r + 1), i = at(c + 1, r + 1);
      const dx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * cs);
      const dy = (g + 2 * hh + i - (a + 2 * b + cc)) / (8 * cs);
      const xy = dx * dx + dy * dy;
      const aspect = Math.atan2(dy, -dx);
      const cang = (Math.sin(alt) - Math.cos(alt) * Math.sqrt(xy) * Math.sin(aspect - az)) / Math.sqrt(1 + xy);
      out[r * w + c] = cang < 0.3 ? 0 : cang < 0.55 ? 1 : cang < 0.75 ? 2 : 3;
    }
  }
  return out;
}
const BAND_VALUE = [0.35, 0.6, 0.8, 1.0];

/* ---------------------------------------------------------------------- build */

export async function buildGround() {
  const { mask } = loadWater();
  const sea3 = downsampleMajority(mask, 2);
  if (sea3.w !== GW || sea3.h !== GH) throw new Error(`3 m mask ${sea3.w}x${sea3.h} != ground ${GW}x${GH}`);
  const mpp = GROUND_MPP;
  const canvas = createCanvas(GW, GH);
  const ctx = canvas.getContext('2d');

  // 1-5: land and areas
  ctx.fillStyle = GROUND.land;
  ctx.fillRect(0, 0, GW, GH);
  drawAreas(ctx, mpp, [2, 3, 4, 5]);

  // 6: hillshade on land only
  const dem3 = await demAt3m();
  const bands = hillshadeBands(dem3, GW, GH, mpp);
  {
    const img = ctx.getImageData(0, 0, GW, GH);
    for (let i = 0; i < GW * GH; i++) {
      if (sea3.data[i]) continue;
      const k = 1 - 0.3 * (1 - BAND_VALUE[bands[i]]);
      img.data[i * 4] = Math.min(255, img.data[i * 4] * k);
      img.data[i * 4 + 1] = Math.min(255, img.data[i * 4 + 1] * k);
      img.data[i * 4 + 2] = Math.min(255, img.data[i * 4 + 2] * k);
    }
    ctx.putImageData(img, 0, 0);
  }
  ensure(DEBUG_DIR);
  {
    const dbg = createCanvas(GW, GH);
    const dctx = dbg.getContext('2d');
    const img = dctx.createImageData(GW, GH);
    for (let i = 0; i < GW * GH; i++) {
      const v = Math.round(BAND_VALUE[bands[i]] * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = sea3.data[i] ? 40 : v;
      img.data[i * 4 + 3] = 255;
    }
    dctx.putImageData(img, 0, 0);
    writeFileSync(resolve(DEBUG_DIR, 'hillshade.png'), dbg.toBuffer('image/png'));
  }

  // 7-8: roads, rail
  drawRoads(ctx, mpp, null, true);
  ctx.strokeStyle = GROUND.rail;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  for (const line of transport().rails) strokeLine(ctx, line, mpp);
  ctx.setLineDash([]);

  // 9: footprints with a 1 px SE shadow
  const bytes = new Uint8Array(gunzipSync(readFileSync(resolve(PUBLIC_MAP_DIR, 'buildings.bin.gz'))));
  const b = decodeBuildings(bytes);
  const ringsOf = (i: number) => {
    const rs: number[][] = [];
    for (let k = b.buildingRingStart[i]; k < b.buildingRingStart[i + 1]; k++) {
      const r: number[] = [];
      for (let v = b.ringVertexStart[k]; v < b.ringVertexStart[k + 1]; v++) r.push(b.xz[v * 2], b.xz[v * 2 + 1]);
      rs.push(r);
    }
    return rs;
  };
  for (const [color, d] of [[GROUND.footprintShadow, 1], [GROUND.footprint, 0]] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < b.count; i++) polyPath(ctx, ringsOf(i), mpp, d, d);
    ctx.fill('evenodd');
  }

  // 10: inland water
  const iw = inlandWater();
  ctx.fillStyle = GROUND.inlandWater;
  ctx.beginPath();
  for (const p of iw.polys) polyPath(ctx, p.rings, mpp);
  ctx.fill('evenodd');
  ctx.strokeStyle = GROUND.inlandWater;
  ctx.lineCap = 'round';
  for (const l of iw.lines) {
    ctx.lineWidth = Math.max(1, l.width / mpp);
    strokeLine(ctx, l.line, mpp);
  }

  // 11-12: sea cut-out and foam on the land side of the coast
  const img = ctx.getImageData(0, 0, GW, GH);
  const [fr, fg, fb] = hexToRgb(GROUND.foam).map((v) => Math.round(v * 255));
  const isSea = (c: number, r: number) => c >= 0 && r >= 0 && c < GW && r < GH && sea3.data[r * GW + c] === 1;
  const foam: number[] = [];
  for (let r = 0; r < GH; r++) {
    for (let c = 0; c < GW; c++) {
      const i = r * GW + c;
      if (sea3.data[i]) continue;
      if (isSea(c - 1, r) || isSea(c + 1, r) || isSea(c, r - 1) || isSea(c, r + 1)) foam.push(i);
    }
  }
  for (let i = 0; i < GW * GH; i++) if (sea3.data[i]) img.data[i * 4 + 3] = 0;
  for (const i of foam) {
    img.data[i * 4] = fr; img.data[i * 4 + 1] = fg; img.data[i * 4 + 2] = fb;
  }
  ctx.putImageData(img, 0, 0);

  // Encode, stepping quality down until the 1.1 MB budget holds.
  let quality = 80;
  let enc = await canvas.encode('webp', quality);
  while (enc.byteLength > 1.05 * 1024 * 1024 && quality > 40) {
    quality -= 5;
    enc = await canvas.encode('webp', quality);
  }
  const groundEntry = writeFile(resolve(PUBLIC_MAP_DIR, 'ground.webp'), enc);

  const LW = Math.ceil(GW / 2), LH = Math.ceil(GH / 2);
  const lo = createCanvas(LW, LH);
  const lctx = lo.getContext('2d');
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'high';
  lctx.drawImage(canvas, 0, 0, LW, LH);
  let lq = 75;
  let lenc = await lo.encode('webp', lq);
  while (lenc.byteLength > 400 * 1024 && lq > 40) { lq -= 5; lenc = await lo.encode('webp', lq); }
  const loEntry = writeFile(resolve(PUBLIC_MAP_DIR, 'ground-lo.webp'), lenc);
  void GROUND_LO_MPP;

  const seaCount = sea3.data.reduce((s, v) => s + v, 0);
  let transparent = 0;
  for (let i = 0; i < GW * GH; i++) if (img.data[i * 4 + 3] === 0) transparent++;
  console.log(
    `ground: ${GW}x${GH} q${quality} ${(groundEntry.bytes / 1024).toFixed(0)} KB, lo ${LW}x${LH} q${lq} ${(loEntry.bytes / 1024).toFixed(0)} KB, alpha-0 ${((100 * transparent) / (GW * GH)).toFixed(2)}% vs sea ${((100 * seaCount) / (GW * GH)).toFixed(2)}%, ${foam.length} foam px, quality ${quality}`,
  );
  return { width: GW, height: GH, loWidth: LW, loHeight: LH, quality, transparent, seaCount };
}
