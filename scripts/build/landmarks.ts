/** Sky Tower anchor, Harbour Bridge profile (from the DSM), Rangitoto. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MapMeta } from '../../src/shared/mapFormat';
import { BOUNDS, WORLD } from '../config';
import { lonLatToLocal, localToLonLat } from '../lib/geo';
import { elementLatLon, geomToLocal, loadOsm, type OsmElement } from '../lib/osm';
import { WORK, ensure } from '../lib/paths';
import { median } from '../lib/raster';
import { loadMosaic, MW, toPx } from './mosaic';

export type Landmarks = MapMeta['landmarks'];

export interface LandmarkReport {
  skyTower: {
    osmElement: string;
    lat: number;
    lon: number;
    x: number;
    z: number;
    groundY: number;
    dsmPeak: { x: number; z: number; rise: number };
    anchorToPeakM: number;
  };
  bridge: { ways: number; nodes: number; lengthM: number; deckMax: number; topMax: number; archTopIndex: number };
}

export const STEP = 10;

async function window(kind: 'dem' | 'dsm', cx: number, cz: number, rx: number, rz: number, pred?: (x: number, z: number) => boolean): Promise<number[]> {
  const m = await loadMosaic(kind);
  const [pc, pr] = toPx(cx, cz);
  const out: number[] = [];
  for (let r = Math.max(0, Math.floor(pr - rz)); r <= Math.min(m.h - 1, Math.ceil(pr + rz)); r++) {
    for (let c = Math.max(0, Math.floor(pc - rx)); c <= Math.min(m.w - 1, Math.ceil(pc + rx)); c++) {
      const v = m.data[r * MW + c];
      if (!Number.isFinite(v)) continue;
      if (pred && !pred(c + 0.5 - pc + cx, r + 0.5 - pr + cz)) continue;
      out.push(v);
    }
  }
  return out;
}

export async function buildLandmarks(): Promise<{ landmarks: Landmarks; report: LandmarkReport }> {
  const places = loadOsm('places').elements;
  const dem = await loadMosaic('dem');
  const dsm = await loadMosaic('dsm');

  // ---- Sky Tower
  const skyEls = places.filter((e) => e.tags?.name === 'Sky Tower');
  if (!skyEls.length) throw new Error('No OSM feature named "Sky Tower" in places.json');
  // Prefer a footprint (way/relation), else a node.
  const sky = skyEls.find((e) => e.type !== 'node' && (e.tags?.building || e.tags?.man_made === 'tower')) ?? skyEls[0];
  const ll = elementLatLon(sky)!;
  const anchor = lonLatToLocal(ll.lon, ll.lat);
  // DSM peak (max DSM - DEM) near the anchor.
  let best = { x: anchor.x, z: anchor.z, rise: -1 };
  {
    const [pc, pr] = toPx(anchor.x, anchor.z);
    for (let r = Math.floor(pr - 40); r <= Math.ceil(pr + 40); r++) {
      for (let c = Math.floor(pc - 40); c <= Math.ceil(pc + 40); c++) {
        const a = dsm.data[r * MW + c], b = dem.data[r * MW + c];
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        if (a - b > best.rise) best = { x: anchor.x + (c + 0.5 - pc), z: anchor.z + (r + 0.5 - pr), rise: a - b };
      }
    }
  }
  const off = Math.hypot(best.x - anchor.x, best.z - anchor.z);
  if (off > 5) throw new Error(`Sky Tower: OSM anchor and DSM peak disagree by ${off.toFixed(1)} m (limit 5 m)`);
  const groundY = median(await window('dem', anchor.x, anchor.z, 10, 10, (x, z) => Math.hypot(x - anchor.x, z - anchor.z) <= 10));
  console.log(`landmarks: Sky Tower ${sky.type}/${sky.id} at ${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)} -> x ${anchor.x.toFixed(1)} z ${anchor.z.toFixed(1)}, ground ${groundY.toFixed(1)} m, DSM peak rise ${best.rise.toFixed(0)} m ${off.toFixed(1)} m off`);

  // ---- Harbour Bridge
  const ways = places.filter(
    (e): e is OsmElement =>
      e.type === 'way' && e.tags?.man_made === 'bridge' && /Harbour Bridge/i.test(e.tags?.name ?? '') && !!e.geometry,
  );
  const pts: number[] = [];
  for (const w of ways) {
    const g = geomToLocal(w.geometry);
    for (let i = 0; i < g.length; i += 2) {
      if (g[i] >= BOUNDS.minX && g[i] <= BOUNDS.maxX && g[i + 1] >= BOUNDS.minZ && g[i + 1] <= BOUNDS.maxZ) pts.push(g[i], g[i + 1]);
    }
  }
  if (pts.length < 8) throw new Error('Harbour Bridge: too few OSM nodes found');
  const n = pts.length / 2;
  let mx = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += pts[i * 2]; mz += pts[i * 2 + 1]; }
  mx /= n; mz /= n;
  let sxx = 0, sxz = 0, szz = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 2] - mx, dz = pts[i * 2 + 1] - mz;
    sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
  }
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let ux = Math.cos(theta), uz = Math.sin(theta);
  if (uz < 0) { ux = -ux; uz = -uz; } // a -> b runs from south (+z) to north (-z)? Point u towards +z first, flip below.
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = (pts[i * 2] - mx) * ux + (pts[i * 2 + 1] - mz) * uz;
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
  }
  // a is the south end (larger z), b the north end; direction a -> b is -u.
  const a = { x: mx + ux * tMax, z: mz + uz * tMax };
  const b = { x: mx + ux * tMin, z: mz + uz * tMin };
  const dx = (b.x - a.x), dz = (b.z - a.z);
  const len = Math.hypot(dx, dz);
  const vx = dx / len, vz = dz / len; // a -> b
  const nx = -vz, nz = vx;
  const samples = Math.floor(len / STEP) + 1;
  const deckY: number[] = [], topY: number[] = [];
  for (let i = 0; i < samples; i++) {
    const cx = a.x + vx * i * STEP, cz = a.z + vz * i * STEP;
    const inStrip = (x: number, z: number) => {
      const ax = (x - cx) * vx + (z - cz) * vz;
      return Math.abs(ax) <= STEP / 2;
    };
    const across = (x: number, z: number) => Math.abs((x - cx) * nx + (z - cz) * nz);
    const vals = await window('dsm', cx, cz, 25, 25, (x, z) => inStrip(x, z) && across(x, z) <= 15);
    // The truss rises over the middle lanes, so the plain strip median reads steel at the crown. The deck
    // is taken from the outer clip-on lanes (|across| 11-15 m), falling back to the whole strip.
    const outer = await window('dsm', cx, cz, 25, 25, (x, z) => inStrip(x, z) && across(x, z) > 11 && across(x, z) <= 15);
    if (!vals.length) { deckY.push(i ? deckY[i - 1] : 0); topY.push(i ? topY[i - 1] : 0); continue; }
    deckY.push(Math.round(median(outer.length >= 8 ? outer : vals) * 10) / 10);
    topY.push(Math.round(Math.max(...vals) * 10) / 10);
  }
  let ti = 0;
  for (let i = 0; i < topY.length; i++) if (topY[i] > topY[ti]) ti = i;
  const archTop = { x: a.x + vx * ti * STEP, z: a.z + vz * ti * STEP, y: topY[ti] };
  const deckMax = Math.max(...deckY), topMax = Math.max(...topY);
  console.log(`landmarks: Harbour Bridge ${ways.length} ways, ${len.toFixed(0)} m long, deck max ${deckMax}, truss top ${topMax}, archTop x ${archTop.x.toFixed(0)} z ${archTop.z.toFixed(0)} y ${archTop.y}`);

  const [rLon, rLat] = [174.86, -36.786];
  const rp = lonLatToLocal(rLon, rLat);
  const landmarks: Landmarks = {
    skyTower: { x: round1(anchor.x), z: round1(anchor.z), groundY: round1(groundY), height: 328 },
    harbourBridge: {
      a: { x: round1(a.x), z: round1(a.z) },
      b: { x: round1(b.x), z: round1(b.z) },
      step: STEP,
      deckY,
      topY,
      archTop: { x: round1(archTop.x), z: round1(archTop.z), y: archTop.y },
    },
    rangitoto: { x: round1(rp.x), z: round1(rp.z), summitY: 260, baseRadius: 2800 },
  };
  const report: LandmarkReport = {
    skyTower: { osmElement: `${sky.type}/${sky.id}`, lat: ll.lat, lon: ll.lon, x: anchor.x, z: anchor.z, groundY, dsmPeak: best, anchorToPeakM: off },
    bridge: { ways: ways.length, nodes: n, lengthM: len, deckMax, topMax, archTopIndex: ti },
  };
  ensure(WORK);
  writeFileSync(resolve(WORK, 'landmarks.json'), JSON.stringify({ landmarks, report }, null, 1));
  void WORLD; void localToLonLat;
  return { landmarks, report };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function loadLandmarks(): { landmarks: Landmarks; report: LandmarkReport } {
  return JSON.parse(readFileSync(resolve(WORK, 'landmarks.json'), 'utf8'));
}
