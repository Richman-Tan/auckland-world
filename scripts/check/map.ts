/** npm run map:check: validates public/map against the budgets and sanity ranges. Exits non-zero on any failure. */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { content } from '../../src/content';
import { placeStops } from '../../src/app/placement';
import {
  decodeBuildings,
  decodeLand,
  decodeRoads,
  decodeTerrain,
  isMapMeta,
  latLonToLocal,
  ringSignedAreaNorthUp,
  sampleTerrain,
  type MapMeta,
} from '../../src/shared/mapFormat';
import { CANOPY_TALL, LAND_CLASSES, landCellAt } from '../../src/shared/land';
import { PUBLIC_MAP_DIR } from '../config';
import { sha256 } from '../lib/io';
import { WORK } from '../lib/paths';
import { loadMosaic, MW, toPx } from '../build/mosaic';
import { downsampleMajority, loadWater } from '../build/water';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}
const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

const metaPath = resolve(PUBLIC_MAP_DIR, 'meta.json');
const metaRaw = JSON.parse(readFileSync(metaPath, 'utf8'));
check('meta isMapMeta', isMapMeta(metaRaw), 'meta.json shape');
if (!isMapMeta(metaRaw)) process.exit(1);
const meta: MapMeta = metaRaw;
const report = JSON.parse(readFileSync(resolve(WORK, 'report.json'), 'utf8'));

/* ---- files and budgets */
let total = 0;
for (const [name, e] of Object.entries(meta.files)) {
  const b = readFileSync(resolve(PUBLIC_MAP_DIR, name));
  check(`file ${name}`, b.byteLength === e.bytes && sha256(b) === e.sha256, `${kb(b.byteLength)}, sha256 ${sha256(b).slice(0, 12)}`);
  total += b.byteLength;
}
for (const f of [meta.terrain.file, meta.buildings.file, meta.ground.file, meta.ground.loFile, meta.minimap.file]) {
  check(`file listed ${f}`, !!meta.files[f], 'present in meta.files');
}
check('total budget', total <= 3 * 1024 * 1024, `${(total / 1048576).toFixed(2)} MB of 3 MB (aim 2.2)`);
const size = (f: string) => meta.files[f]?.bytes ?? Infinity;
check('buildings budget', size(meta.buildings.file) <= 900 * 1024, kb(size(meta.buildings.file)));
check('ground budget', size(meta.ground.file) <= 1.1 * 1048576, kb(size(meta.ground.file)));
check('terrain budget', size(meta.terrain.file) <= 200 * 1024, kb(size(meta.terrain.file)));
check('minimap budget', size(meta.minimap.file) <= 100 * 1024, kb(size(meta.minimap.file)));
// What has to arrive before the city is first shown. Close-up detail loads after that, so it may
// grow the total but never this.
const firstReveal = size(meta.terrain.file) + size(meta.buildings.file) + size(meta.ground.file);
check('first reveal budget', firstReveal <= 1.8 * 1e6, `${(firstReveal / 1e6).toFixed(2)} MB of 1.80 MB (terrain, buildings, ground)`);

/* ---- close-up detail */
if (meta.detail?.roads) {
  const r = meta.detail.roads;
  check('roads budget', size(r.file) <= 170 * 1024, kb(size(r.file)));
  const roads = decodeRoads(new Uint8Array(gunzipSync(readFileSync(resolve(PUBLIC_MAP_DIR, r.file)))));
  check('road counts match meta', roads.count === r.ways && roads.vertexCount === r.vertices, `${roads.count} ways / ${roads.vertexCount} vertices`);
  let km = 0;
  let out = 0;
  let longest = 0;
  for (let w = 0; w < roads.count; w++) {
    for (let v = roads.wayStart[w]; v < roads.wayStart[w + 1]; v++) {
      const x = roads.xz[v * 2];
      const z = roads.xz[v * 2 + 1];
      if (x < meta.bounds.minX || x > meta.bounds.maxX || z < meta.bounds.minZ || z > meta.bounds.maxZ) out++;
      if (v > roads.wayStart[w]) {
        const d = Math.hypot(x - roads.xz[v * 2 - 2], z - roads.xz[v * 2 - 1]);
        km += d / 1000;
        longest = Math.max(longest, d);
      }
    }
  }
  check('road network length', within(km, 400, 1400), `${km.toFixed(0)} km`);
  check('roads inside bounds', out === 0, `${out} vertices outside`);
  check('no absurd road segment', longest < 1500, `longest segment ${longest.toFixed(0)} m`);
}
if (meta.detail?.land) {
  const l = meta.detail.land;
  check('land budget', size(l.file) <= 320 * 1024, kb(size(l.file)));
  const land = decodeLand(new Uint8Array(gunzipSync(readFileSync(resolve(PUBLIC_MAP_DIR, l.file)))));
  check('land grid matches meta', land.width === l.width && land.height === l.height && land.cell === l.cell, `${land.width}x${land.height} at ${land.cell} m`);
  const covers = land.width * land.cell >= meta.bounds.maxX - meta.bounds.minX && land.height * land.cell >= meta.bounds.maxZ - meta.bounds.minZ;
  check('land grid covers the map', covers, `${land.width * land.cell} x ${land.height * land.cell} m`);
  let badClass = 0, badCanopy = 0, canopy = 0, seaCanopy = 0, landCells = 0;
  const sea6 = downsampleMajority(loadWater().mask, 4);
  for (let i = 0; i < land.cls.length; i++) {
    if (land.cls[i] >= LAND_CLASSES.length) badClass++;
    if (land.canopy[i] > CANOPY_TALL) badCanopy++;
    const wet = sea6.w === land.width && sea6.data[i] === 1;
    if (!wet) landCells++;
    if (land.canopy[i]) {
      canopy++;
      if (wet) seaCanopy++;
    }
  }
  check('land classes valid', badClass === 0 && badCanopy === 0, `${badClass} bad classes, ${badCanopy} bad canopy values`);
  check('no trees in the sea', seaCanopy === 0, `${seaCanopy} canopy cells at sea`);
  // Auckland's urban canopy is a little under a fifth of the land; far from that means the LiDAR test has broken.
  const share = canopy / Math.max(1, landCells);
  check('tree canopy share', within(share, 0.1, 0.28), `${(share * 100).toFixed(1)}% of the land`);
  const at = (lat: number, lon: number) => {
    const p = latLonToLocal(meta.geo, lat, lon);
    return LAND_CLASSES[land.cls[landCellAt(land, meta.bounds.minX, meta.bounds.minZ, p.x, p.z)]];
  };
  const domain = at(-36.8590, 174.7755);
  check('the Domain is green', domain === 'park' || domain === 'pitch' || domain === 'wood', domain ?? 'outside the grid');
  const terminal = latLonToLocal(meta.geo, -36.8437, 174.7850);
  let stacks = 0;
  for (let dz = -150; dz <= 150; dz += 6) for (let dx = -150; dx <= 150; dx += 6) if (land.canopy[landCellAt(land, meta.bounds.minX, meta.bounds.minZ, terminal.x + dx, terminal.z + dz)]) stacks++;
  // Without the roughness test about a fifth of the terminal reads as canopy.
  check('container stacks are not trees', stacks < 2601 * 0.03, `${stacks} canopy cells of 2601 on the container terminal`);
}

/* ---- buildings */
const unz = (f: string) => new Uint8Array(gunzipSync(readFileSync(resolve(PUBLIC_MAP_DIR, f))));
const terrain = decodeTerrain(unz(meta.terrain.file));
const b = decodeBuildings(unz(meta.buildings.file));
check('building counts match meta', b.count === meta.buildings.count && b.ringCount === meta.buildings.rings && b.vertexCount === meta.buildings.vertices, `${b.count} / ${b.ringCount} / ${b.vertexCount}`);
const bd = meta.bounds;
let outside = 0, cwOuter = 0, badY = 0, nan = 0;
const heights: number[] = [];
const sky = meta.landmarks.skyTower;
let nearTall = 0, tallest = 0;
const neighbours: string[] = [];
for (let i = 0; i < b.count; i++) {
  if (!(b.topY[i] > b.baseY[i])) badY++;
  if (Number.isNaN(b.topY[i]) || Number.isNaN(b.baseY[i])) nan++;
  let sx = 0, sz = 0, nv = 0;
  for (let k = b.buildingRingStart[i]; k < b.buildingRingStart[i + 1]; k++) {
    const v0 = b.ringVertexStart[k], v1 = b.ringVertexStart[k + 1];
    for (let v = v0; v < v1; v++) {
      const x = b.xz[v * 2], z = b.xz[v * 2 + 1];
      if (Number.isNaN(x) || Number.isNaN(z)) nan++;
      if (x < bd.minX || x > bd.maxX || z < bd.minZ || z > bd.maxZ) outside++;
      if (k === b.buildingRingStart[i]) { sx += x; sz += z; nv++; }
    }
    const a = ringSignedAreaNorthUp(b.xz.subarray(v0 * 2, v1 * 2));
    if (k === b.buildingRingStart[i] ? a <= 0 : a >= 0) cwOuter++;
  }
  const h = b.topY[i] - sampleTerrain(terrain, sx / nv, sz / nv);
  heights.push(h);
  if (h > tallest) tallest = h;
  const dSky = Math.hypot(sx / nv - sky.x, sz / nv - sky.z);
  if (h > 60 && dSky < 45) nearTall++;
  if (h > 60 && dSky < 80) neighbours.push(`${h.toFixed(0)} m at ${dSky.toFixed(0)} m`);
}
check('building vertices inside bounds', outside === 0, `${outside} outside`);
check('ring orientation (outer CCW, holes CW)', cwOuter === 0, `${cwOuter} wrong`);
check('topY > baseY, no NaN', badY === 0 && nan === 0, `${badY} bad, ${nan} NaN`);
check('building count 18k-34k', within(b.count, 18000, 34000), `${b.count}`);
heights.sort((x, y) => x - y);
const med = heights[heights.length >> 1];
check('median height 5-9 m', within(med, 5, 9), `${med.toFixed(2)} m`);
check('tallest building 140-200 m', within(tallest, 140, 200), `${tallest.toFixed(1)} m`);
// The plan says 80 m, but real apartment towers on Victoria St West (OSM: 26 levels, LiDAR-confirmed) sit 62-83 m away.
// The check that matters is that the tower itself (25 m masked, plus a margin) leaks no mast into a neighbour.
check('nothing > 60 m within 45 m of Sky Tower', nearTall === 0, `${nearTall} buildings`);
console.log(`info  buildings > 60 m within 80 m of Sky Tower (real neighbours): ${neighbours.join(', ') || 'none'}`);
const br = report.buildings;
check('>= 85% LiDAR heights', br.lidarPct >= 85, `${br.lidarPct.toFixed(1)}% (${JSON.stringify(br.sources)})`);
check('global shift small or applied', br.shift.magnitudeM <= 1.5 || br.shift.applied, `best dE ${br.shift.bestDE} dN ${br.shift.bestDN}, ${(br.shift.improvement * 100).toFixed(2)}% gain, applied ${br.shift.applied}`);

/* ---- terrain and landmarks (re-derived from the LiDAR) */
const dem = await loadMosaic('dem');
const dsm = await loadMosaic('dsm');
function demMax(x: number, z: number, r: number) {
  const [pc, pr] = toPx(x, z);
  let m = -1e9;
  for (let rr = Math.floor(pr - r); rr <= Math.ceil(pr + r); rr++) for (let cc = Math.floor(pc - r); cc <= Math.ceil(pc + r); cc++) {
    if (Math.hypot(cc + 0.5 - pc, rr + 0.5 - pr) > r) continue;
    const v = dem.data[rr * MW + cc];
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}
// Mt Eden: the OSM peak node (Maungawhau). The plan's (-36.8767, 174.7643) is ~150 m north of the summit.
const peak = meta.places.find((p) => p.kind === 'peak' && /Maungawhau/.test(p.name));
const planned = latLonToLocal(meta.geo, -36.8767, 174.7643);
if (!peak) check('Mt Eden OSM peak present', false, 'no Maungawhau peak in places');
else {
  const dm = demMax(peak.x, peak.z, 60);
  check('Mt Eden DEM max 194-198 (60 m of OSM peak)', within(dm, 194, 198), `${dm.toFixed(2)} m`);
  const tm = sampleTerrain(terrain, peak.x, peak.z);
  check('Mt Eden 20 m terrain 185-198', within(tm, 185, 198), `${tm.toFixed(1)} m`);
  console.log(`info  plan coordinate (-36.8767, 174.7643) is ${Math.hypot(planned.x - peak.x, planned.z - peak.z).toFixed(0)} m from the OSM summit; DEM max there ${demMax(planned.x, planned.z, 60).toFixed(1)} m`);
}
{
  const [pc, pr] = toPx(sky.x, sky.z);
  let rise = 0;
  for (let rr = Math.floor(pr - 15); rr <= Math.ceil(pr + 15); rr++) for (let cc = Math.floor(pc - 15); cc <= Math.ceil(pc + 15); cc++) {
    if (Math.hypot(cc + 0.5 - pc, rr + 0.5 - pr) > 15) continue;
    const a = dsm.data[rr * MW + cc], d = dem.data[rr * MW + cc];
    if (Number.isFinite(a) && Number.isFinite(d)) rise = Math.max(rise, a - d);
  }
  check('Sky Tower max(DSM - DEM) 180-330 m', within(rise, 180, 330), `${rise.toFixed(1)} m`);
  check('Sky Tower ground 30-70 m', within(sky.groundY, 30, 70), `${sky.groundY} m`);
}
const hb = meta.landmarks.harbourBridge;
check('Harbour Bridge deck max 40-50 m', within(Math.max(...hb.deckY), 40, 50), `${Math.max(...hb.deckY)} m`);
check('Harbour Bridge truss top 55-75 m', within(Math.max(...hb.topY), 55, 75), `${Math.max(...hb.topY)} m (archTop y ${hb.archTop.y})`);

/* ---- water */
const w = report.water;
check('water fraction 15-45%', within(w.waterFraction, 0.15, 0.45), `${(w.waterFraction * 100).toFixed(1)}%`);
check('median DEM over water <= 1 m', w.medianDemOverWater <= 1, `${w.medianDemOverWater.toFixed(2)} m`);
check('water cells with DEM > 5 m < 0.5%', w.waterAboveFiveM < 0.005, `${(w.waterAboveFiveM * 100).toFixed(3)}%`);
check('coastline agreement >= 97%', w.coastAgreement >= 0.97, `${(w.coastAgreement * 100).toFixed(2)}% of ${w.coastSegmentsChecked} segments`);
for (const k of [...w.knownLand, ...w.knownWater]) check(`known point ${k.name}`, k.ok, k.ok ? 'classified correctly' : 'misclassified');
{
  const img = await loadImage(readFileSync(resolve(PUBLIC_MAP_DIR, meta.ground.file)));
  const cv = createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) transparent++;
  const sea3 = downsampleMajority(loadWater().mask, 2);
  let wet = 0;
  for (const v of sea3.data) wet += v;
  const fa = transparent / (img.width * img.height), fm = wet / sea3.data.length;
  check('ground size matches meta', img.width === meta.ground.width && img.height === meta.ground.height, `${img.width}x${img.height}`);
  check('ground alpha within 1% of water mask', Math.abs(fa - fm) <= 0.01, `alpha ${(fa * 100).toFixed(2)}% vs mask ${(fm * 100).toFixed(2)}%`);
}

/* ---- geo fit and stops */
check('geo fit residual < 0.05 m', meta.geo.maxResidualM < 0.05, `${meta.geo.maxResidualM.toFixed(4)} m`);
{
  const placements = placeStops(content, meta, (x, z) => Math.max(sampleTerrain(terrain, x, z), meta.water.level));
  for (const p of placements) {
    const inside = Math.min(p.x - bd.minX, bd.maxX - p.x, p.z - bd.minZ, bd.maxZ - p.z);
    check(`stop ${p.id} >= 600 m inside bounds`, inside >= 600, `${inside.toFixed(0)} m (x ${p.x.toFixed(0)}, z ${p.z.toFixed(0)}, ground ${p.groundY.toFixed(0)} m)`);
  }
}

const failed = results.filter((r) => !r.ok);
report.checks = { ranAt: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results };
writeFileSync(resolve(WORK, 'report.json'), JSON.stringify(report, null, 1));
console.log(`\nmap:check ${failed.length ? 'FAILED' : 'passed'}: ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
