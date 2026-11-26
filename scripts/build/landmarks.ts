/** Sky Tower anchor, Harbour Bridge profile (from the DSM), Rangitoto. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MapMeta, SiteBox } from '../../src/shared/mapFormat';
import { boundingRectangle } from '../../src/shared/roofs';
import { BOUNDS, WORLD } from '../config';
import { lonLatToLocal, localToLonLat } from '../lib/geo';
import { pointInRing } from '../lib/geom';
import { elementLatLon, geomToLocal, loadOsm, polygonsOf, type OsmElement } from '../lib/osm';
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
  const deckY: number[] = [], topY: number[] = [], underY: number[] = [];
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
    // What lies under the bridge here: the bare-earth model, which reads below zero over the sea.
    const bare = await window('dem', cx, cz, 25, 25, (x, z) => inStrip(x, z) && across(x, z) <= 15);
    underY.push(bare.length ? Math.max(0, Math.round(median(bare) * 10) / 10) : 0);
    if (!vals.length) { deckY.push(i ? deckY[i - 1] : 0); topY.push(i ? topY[i - 1] : 0); continue; }
    deckY.push(Math.round(median(outer.length >= 8 ? outer : vals) * 10) / 10);
    topY.push(Math.round(Math.max(...vals) * 10) / 10);
  }
  // Remove single-sample spikes (the navigation-light mast at the crown reads about 9 m above the truss).
  for (let i = 1; i < topY.length - 1; i++) {
    const neighbours = Math.max(topY[i - 1], topY[i + 1]);
    if (topY[i] - neighbours > 4) topY[i] = Math.round(((topY[i - 1] + topY[i + 1]) / 2) * 10) / 10;
  }
  let ti = 0;
  for (let i = 0; i < topY.length; i++) if (topY[i] > topY[ti]) ti = i;
  const archTop = { x: a.x + vx * ti * STEP, z: a.z + vz * ti * STEP, y: topY[ti] };
  const deckMax = Math.max(...deckY), topMax = Math.max(...topY);
  console.log(`landmarks: Harbour Bridge ${ways.length} ways, ${len.toFixed(0)} m long, deck max ${deckMax}, truss top ${topMax}, archTop x ${archTop.x.toFixed(0)} z ${archTop.z.toFixed(0)} y ${archTop.y}`);

  // ---- landmarks modelled by hand: what the map and the LiDAR say about each
  const [dc0, dr0] = toPx(0, 0);
  const sample = (m: { data: Float32Array }, x: number, z: number) => {
    const c = Math.floor(x + dc0);
    const r = Math.floor(z + dr0);
    return c < 0 || r < 0 || c >= MW || r >= dem.h ? NaN : m.data[r * MW + c];
  };
  /** Ground and surface heights inside a ring: the ground's median, and the surface at a few points of its spread. */
  const heights = (ring: number[]) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
    }
    const hs: number[] = [], gs: number[] = [];
    for (let z = Math.floor(minZ) + 0.5; z <= maxZ; z += 1) {
      for (let x = Math.floor(minX) + 0.5; x <= maxX; x += 1) {
        if (!pointInRing(x, z, ring)) continue;
        const h = sample(dsm, x, z), g = sample(dem, x, z);
        if (Number.isFinite(h)) hs.push(h);
        if (Number.isFinite(g)) gs.push(g);
      }
    }
    hs.sort((p, q) => p - q);
    const at = (q: number) => (hs.length ? hs[Math.min(hs.length - 1, Math.floor(q * hs.length))] : 0);
    return { ground: gs.length ? Math.max(0, median(gs)) : 0, mid: at(0.5), high: at(0.9), top: at(0.99) };
  };
  const siteBox = (ring: number[]): SiteBox => {
    const r = boundingRectangle(ring);
    const h = heights(ring);
    return {
      x: round1(r.cx), z: round1(r.cz), ux: Math.round(r.ux * 1e4) / 1e4, uz: Math.round(r.uz * 1e4) / 1e4,
      halfLength: round1(r.halfLength), halfWidth: round1(r.halfWidth), groundY: round1(h.ground), roofY: round1(h.mid), topY: round1(h.top),
    };
  };
  const buildingEls = loadOsm('buildings').elements;
  const areaEls = loadOsm('areas').elements;
  const outline = (el: OsmElement) => polygonsOf(el)[0]?.rings[0];

  const museumEl = buildingEls.find((e) => /War Memorial Museum/.test(e.tags?.name ?? ''));
  const museumRing = museumEl && outline(museumEl);
  let museum: SiteBox | undefined;
  if (museumRing) {
    museum = siteBox(museumRing);
    // The long side points at the front, which faces the harbour: north.
    if (museum.uz > 0) { museum.ux = -museum.ux; museum.uz = -museum.uz; }
  }

  let edenPark: Landmarks['edenPark'];
  const stadiumEl = areaEls.find((e) => /Eden Park/.test(e.tags?.name ?? '') && e.tags?.leisure === 'stadium');
  const stadiumRing = stadiumEl && outline(stadiumEl);
  if (stadiumRing) {
    const stands = buildingEls
      .filter((e) => e.tags?.building === 'grandstand' || e.tags?.building === 'stadium')
      .map(outline)
      .filter((ring): ring is number[] => !!ring && pointInRing(boundingRectangle(ring).cx, boundingRectangle(ring).cz, stadiumRing) && boundingRectangle(ring).area > 1500)
      .map(siteBox);
    if (stands.length >= 2) {
      // The pitch lies between the two biggest stands, as long as they are and as wide as the gap between them.
      const [p, q] = [...stands].sort((s, t) => t.halfLength - s.halfLength);
      const x = (p.x + q.x) / 2, z = (p.z + q.z) / 2;
      const gap = Math.abs((q.x - p.x) * -p.uz + (q.z - p.z) * p.ux) - p.halfWidth - q.halfWidth;
      const ground = Math.min(...stands.map((s) => s.groundY));
      edenPark = {
        stands,
        pitch: { x: round1(x), z: round1(z), ux: p.ux, uz: p.uz, halfLength: round1(Math.min(p.halfLength, q.halfLength) * 0.62), halfWidth: round1(Math.max(20, gap / 2 - 4)), groundY: round1(ground), roofY: round1(ground), topY: round1(ground) },
      };
    }
  }

  const silos: NonNullable<Landmarks['silos']> = [];
  for (const el of buildingEls) {
    if (el.tags?.building !== 'silo') continue;
    const ring = outline(el);
    if (!ring) continue;
    const r = boundingRectangle(ring);
    const h = heights(ring);
    if (h.top - h.ground < 15) continue;
    silos.push({ x: round1(r.cx), z: round1(r.cz), r: round1(Math.sqrt(r.area / Math.PI)), groundY: round1(h.ground), topY: round1(h.high) });
  }

  let wynyardCrossing: Landmarks['wynyardCrossing'];
  const crossingEl = places.find((e) => /Wynyard Crossing/.test(e.tags?.name ?? '') && e.tags?.man_made === 'bridge' && !!e.geometry);
  if (crossingEl) {
    const line = geomToLocal(crossingEl.geometry);
    const r = boundingRectangle(line.slice(0, -2));
    wynyardCrossing = {
      a: { x: round1(r.cx - r.ux * r.halfLength), z: round1(r.cz - r.uz * r.halfLength) },
      b: { x: round1(r.cx + r.ux * r.halfLength), z: round1(r.cz + r.uz * r.halfLength) },
      halfWidth: round1(Math.max(2, r.halfWidth)),
      // The walkway's own height: the middle of what LiDAR saw of it (its masts are far higher).
      deckY: round1(Math.max(2.5, heights(line.slice(0, -2)).mid)),
    };
  }

  // The container terminal, and its cranes: whatever stands more than forty metres over the quays.
  let port: Landmarks['port'];
  const terminalEl = areaEls.find((e) => /Fergusson Container Terminal/.test(e.tags?.name ?? ''));
  const terminalRing = terminalEl && outline(terminalEl);
  if (terminalRing) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < terminalRing.length; i += 2) {
      minX = Math.min(minX, terminalRing[i]); maxX = Math.max(maxX, terminalRing[i]);
      minZ = Math.min(minZ, terminalRing[i + 1]); maxZ = Math.max(maxZ, terminalRing[i + 1]);
    }
    const CELL = 10;
    const tall = new Map<string, number>();
    const land = new Set<string>();
    for (let z = minZ - 70; z <= maxZ + 70; z += 1) {
      for (let x = minX - 70; x <= maxX + 70; x += 1) {
        const h = sample(dsm, x, z);
        if (!Number.isFinite(h)) continue;
        const g = sample(dem, x, z);
        const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
        if (Number.isFinite(g) && g > 1) land.add(key);
        if (h - (Number.isFinite(g) ? Math.max(0, g) : 0) > 40) tall.set(key, Math.max(tall.get(key) ?? 0, h));
      }
    }
    const seen = new Set<string>();
    const cranes: NonNullable<Landmarks['port']>['cranes'] = [];
    for (const start of tall.keys()) {
      if (seen.has(start)) continue;
      const cells: [number, number][] = [];
      const stack = [start];
      seen.add(start);
      let top = 0;
      while (stack.length) {
        const cur = stack.pop() as string;
        const [cx, cz] = cur.split(',').map(Number);
        cells.push([cx * CELL + CELL / 2, cz * CELL + CELL / 2]);
        top = Math.max(top, tall.get(cur) as number);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const k = `${cx + dx},${cz + dz}`;
          if (tall.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
        }
      }
      // A crane and its boom cover a couple of thousand square metres; a mast or a bird does not. And nothing here is 150 m high.
      if (cells.length < 20 || top > 150) continue;
      // The boom lies along the long axis of what was seen; the frame stands on the part that is over land.
      let mx = 0, mz = 0;
      for (const [x, z] of cells) { mx += x; mz += z; }
      mx /= cells.length; mz /= cells.length;
      let sxx = 0, sxz = 0, szz = 0;
      for (const [x, z] of cells) { sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2; }
      const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      let bx = Math.cos(angle), bz = Math.sin(angle);
      const onLand = cells.filter(([x, z]) => land.has(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`));
      const over = cells.filter(([x, z]) => !land.has(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`));
      if (onLand.length < 4) continue;
      let lx = 0, lz = 0;
      for (const [x, z] of onLand) { lx += x; lz += z; }
      lx /= onLand.length; lz /= onLand.length;
      // The boom points from the land out over the water.
      if (over.length) {
        let wx = 0, wz = 0;
        for (const [x, z] of over) { wx += x; wz += z; }
        if ((wx / over.length - lx) * bx + (wz / over.length - lz) * bz < 0) { bx = -bx; bz = -bz; }
      }
      // More than one crane side by side reads as one wide thing: one for every 45 m along the quay.
      let across = 0;
      for (const [x, z] of onLand) across = Math.max(across, Math.abs((x - lx) * -bz + (z - lz) * bx));
      const count = Math.max(1, Math.round((across * 2 + CELL) / 55));
      for (let k = 0; k < count; k++) {
        const off = count === 1 ? 0 : (k / (count - 1) - 0.5) * (across * 2 - 30);
        cranes.push({ x: round1(lx - bz * off), z: round1(lz + bx * off), ux: Math.round(bx * 1e3) / 1e3, uz: Math.round(bz * 1e3) / 1e3, topY: round1(Math.min(top, 125)) });
      }
    }
    cranes.sort((p, q) => p.x - q.x || p.z - q.z);
    port = { ring: terminalRing.map(round1), groundY: round1(heights(terminalRing).ground), cranes };
  }
  console.log(`landmarks: museum ${museum ? 'found' : 'missing'}, Eden Park ${edenPark ? `${edenPark.stands.length} stands` : 'missing'}, ${silos.length} silos, Wynyard Crossing ${wynyardCrossing ? 'found' : 'missing'}, port ${port ? `${port.cranes.length} cranes` : 'missing'}`);

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
      groundY: underY,
      archTop: { x: round1(archTop.x), z: round1(archTop.z), y: archTop.y },
    },
    rangitoto: { x: round1(rp.x), z: round1(rp.z), summitY: 260, baseRadius: 2800 },
    ...(museum ? { museum } : {}),
    ...(edenPark ? { edenPark } : {}),
    ...(silos.length ? { silos } : {}),
    ...(wynyardCrossing ? { wynyardCrossing } : {}),
    ...(port ? { port } : {}),
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
