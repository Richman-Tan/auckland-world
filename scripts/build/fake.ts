/**
 * A synthetic world in the real formats (public/map-fake/), so the renderer, flight and UI can be
 * built before the real pipeline lands. Shapes are only loosely Auckland: a harbour to the north,
 * a north shore beyond it, a Hobson Bay inlet, Mt Eden and the Domain as cones, a CBD of towers.
 * Landmark anchors and the geo fit are real, so stops land where they will on the real map.
 *
 * Run: npm run map:fake
 */
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import {
  type BuildingRecord,
  type FileEntry,
  type MapMeta,
  type RoadWay,
  MAP_FORMAT_VERSION,
  type TerrainGrid,
  encodeRoads,
  encodeBuildings,
  encodeTerrain,
  sampleTerrain,
} from '../../src/shared/mapFormat';
import { ROAD_CLASSES, roadFlags } from '../../src/shared/roads';
import { GROUND, makeStyle } from '../../src/shared/palette';
import {
  ATTRIBUTION,
  BOUNDS,
  COLLISION_CELL,
  GROUND_LO_MPP,
  GROUND_MPP,
  MINIMAP_WIDTH,
  PUBLIC_FAKE_DIR,
  TERRAIN_CELL,
  WORLD,
} from '../config';
import { fitGeo, lonLatToLocal, localToLonLat, trueNorthAngleRad } from '../lib/geo';
import { clipLine } from '../lib/geom';
import { writeFile, writeGz } from '../lib/io';

/* Deterministic random. */
let seed = 1337;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const skyTower = lonLatToLocal(174.7622, -36.8485);
const mtEden = lonLatToLocal(174.7643, -36.8767);
const domain = lonLatToLocal(174.7775, -36.8605);
const mtVic = lonLatToLocal(174.7972, -36.8268);
const bridgeA = lonLatToLocal(174.7468, -36.839);
const bridgeB = lonLatToLocal(174.7428, -36.8262);
const rangitoto = lonLatToLocal(174.86, -36.786);

/** Southern shore of the harbour, as z for a given x (north is -z). */
function southShore(x: number): number {
  return -1300 + 220 * Math.sin(x / 520) + 120 * Math.sin(x / 190 + 1) - (x < -1800 ? 300 : 0);
}
function northShore(x: number): number {
  return -2900 + 260 * Math.sin(x / 640 + 2) + 100 * Math.sin(x / 230);
}
function isWater(x: number, z: number): boolean {
  if (z < southShore(x) && z > northShore(x)) return true;
  // Hobson Bay inlet in the east.
  if (x > 2300 && z > -1300 && z < 600 + 200 * Math.sin(z / 300)) return true;
  return false;
}
function cone(x: number, z: number, cx: number, cz: number, h: number, r: number, crater = 0): number {
  const d = Math.hypot(x - cx, z - cz);
  if (d > r) return 0;
  const t = 1 - d / r;
  let v = h * t * t * (3 - 2 * t);
  if (crater > 0 && d < crater) v -= (crater - d) * 0.35;
  return v;
}
function landHeight(x: number, z: number): number {
  let h = 18 + 14 * Math.sin(x / 700) * Math.cos(z / 900) + 8 * Math.sin(z / 350 + x / 500);
  h += 30 * Math.exp(-Math.hypot(x - skyTower.x, z - skyTower.z) / 900);
  h += cone(x, z, mtEden.x, mtEden.z, 160, 520, 90);
  h += cone(x, z, domain.x, domain.z, 45, 500);
  h += cone(x, z, mtVic.x, mtVic.z, 75, 260);
  return Math.max(h, 2);
}

/* ------------------------------------------------------------------ terrain */

const cols = Math.round((BOUNDS.maxX - BOUNDS.minX) / TERRAIN_CELL) + 1;
const rows = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / TERRAIN_CELL) + 1;
const heights = new Float32Array(cols * rows);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const x = BOUNDS.minX + c * TERRAIN_CELL;
    const z = BOUNDS.minZ + r * TERRAIN_CELL;
    heights[r * cols + c] = isWater(x, z) ? -3 : landHeight(x, z);
  }
}
const terrain: TerrainGrid = { cols, rows, cell: TERRAIN_CELL, x0: BOUNDS.minX, z0: BOUNDS.minZ, minH: 0, maxH: 0, heights };
const groundAt = (x: number, z: number) => sampleTerrain(terrain, x, z);

/* ---------------------------------------------------------------- buildings */

const buildings: BuildingRecord[] = [];
const footprints: number[][] = [];
function tryBuilding(cx: number, cz: number, w: number, d: number, rot: number, h: number, cbd: boolean) {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const ring: number[] = [];
  // Counter-clockwise on a north-up map: (x, -z) positive area.
  const corners: [number, number][] = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
  let minG = Infinity;
  let maxG = -Infinity;
  for (const [u, v] of corners) {
    const x = cx + u * cs - v * sn;
    const z = cz + u * sn + v * cs;
    if (isWater(x, z)) return;
    if (x < BOUNDS.minX + 50 || x > BOUNDS.maxX - 50 || z < BOUNDS.minZ + 50 || z > BOUNDS.maxZ - 50) return;
    const g = groundAt(x, z);
    minG = Math.min(minG, g);
    maxG = Math.max(maxG, g);
    ring.push(x, z);
  }
  if (Math.hypot(cx - skyTower.x, cz - skyTower.z) < 40) return;
  // Keep the bridge approaches clear.
  if (Math.hypot(cx - bridgeA.x, cz - bridgeA.z) < 120) return;
  // Ensure counter-clockwise (positive area in (x, -z)).
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += ring[i * 2] * -ring[j * 2 + 1] - ring[j * 2] * -ring[i * 2 + 1];
  }
  if (area < 0) {
    const rev: number[] = [];
    for (let i = 3; i >= 0; i--) rev.push(ring[i * 2], ring[i * 2 + 1]);
    ring.splice(0, ring.length, ...rev);
  }
  const top = Math.max(groundAt(cx, cz) + h, maxG + 2.5);
  const wall = cbd ? (h > 40 ? Math.floor(rand() * 3) : 3 + Math.floor(rand() * 3)) : 6 + Math.floor(rand() * 5);
  const roof = cbd ? 5 + Math.floor(rand() * 3) : Math.floor(rand() * 5);
  buildings.push({ rings: [ring], baseY: minG - 2, topY: top, style: makeStyle(wall, roof) });
  footprints.push(ring);
}

// CBD towers around Sky Tower.
for (let i = 0; i < 420; i++) {
  const a = rand() * Math.PI * 2;
  const d = 60 + Math.sqrt(rand()) * 850;
  const cx = skyTower.x + Math.cos(a) * d;
  const cz = skyTower.z + Math.sin(a) * d;
  const h = 15 + Math.pow(rand(), 2.2) * 160 * (1 - d / 1100);
  tryBuilding(cx, cz, 18 + rand() * 25, 18 + rand() * 25, 0.05 * (rand() - 0.5), h, true);
}
// Suburbs: a jittered street grid of houses.
for (let gx = BOUNDS.minX + 100; gx < BOUNDS.maxX - 100; gx += 70) {
  for (let gz = BOUNDS.minZ + 100; gz < BOUNDS.maxZ - 100; gz += 60) {
    if (Math.hypot(gx - skyTower.x, gz - skyTower.z) < 950) continue;
    if (Math.hypot(gx - mtEden.x, gz - mtEden.z) < 420) continue;
    if (Math.hypot(gx - domain.x, gz - domain.z) < 380) continue;
    if (rand() < 0.35) continue;
    tryBuilding(gx + (rand() - 0.5) * 25, gz + (rand() - 0.5) * 20, 10 + rand() * 8, 12 + rand() * 10, 0.2 * (rand() - 0.5), 4 + rand() * 5, false);
  }
}

/* ------------------------------------------------------------ Harbour Bridge */

const step = 10;
const blen = Math.hypot(bridgeB.x - bridgeA.x, bridgeB.z - bridgeA.z);
const samples = Math.floor(blen / step) + 1;
const deckY: number[] = [];
const topY: number[] = [];
for (let i = 0; i < samples; i++) {
  const f = (i * step) / blen;
  const deck = 12 + 31 * Math.sin(Math.min(f / 0.75, 1) * (Math.PI / 2)) - (f > 0.9 ? (f - 0.9) * 200 : 0);
  deckY.push(Math.round(deck * 10) / 10);
  const truss = f > 0.45 && f < 0.95 ? 18 * Math.sin(((f - 0.45) / 0.5) * Math.PI) + 6 : 0;
  topY.push(Math.round((deck + truss) * 10) / 10);
}
let topIdx = 0;
for (let i = 0; i < topY.length; i++) if (topY[i] > topY[topIdx]) topIdx = i;
const ux = (bridgeB.x - bridgeA.x) / blen;
const uz = (bridgeB.z - bridgeA.z) / blen;

/* ---------------------------------------------------------- ground & minimap */

function drawGround(mpp: number, opaqueSea: boolean, withFootprints: boolean) {
  const w = Math.round((BOUNDS.maxX - BOUNDS.minX) / mpp);
  const h = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / mpp);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const px = (x: number) => (x - BOUNDS.minX) / mpp;
  const pz = (z: number) => (z - BOUNDS.minZ) / mpp;
  ctx.fillStyle = GROUND.land;
  ctx.fillRect(0, 0, w, h);
  // Parks on the cones.
  ctx.fillStyle = GROUND.park;
  for (const [c, r] of [[mtEden, 420], [domain, 380], [mtVic, 200]] as const) {
    ctx.beginPath();
    ctx.arc(px(c.x), pz(c.z), r / mpp, 0, Math.PI * 2);
    ctx.fill();
  }
  // Roads: a loose grid.
  ctx.strokeStyle = GROUND.road;
  ctx.lineWidth = Math.max(1, 7 / mpp);
  for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += 280) {
    ctx.beginPath();
    ctx.moveTo(px(x), 0);
    ctx.lineTo(px(x + 120), h);
    ctx.stroke();
  }
  for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += 240) {
    ctx.beginPath();
    ctx.moveTo(0, pz(z));
    ctx.lineTo(w, pz(z + 90));
    ctx.stroke();
  }
  if (withFootprints) {
    ctx.fillStyle = GROUND.footprint;
    for (const ring of footprints) {
      ctx.beginPath();
      ctx.moveTo(px(ring[0]), pz(ring[1]));
      for (let i = 2; i < ring.length; i += 2) ctx.lineTo(px(ring[i]), pz(ring[i + 1]));
      ctx.closePath();
      ctx.fill();
    }
  }
  // Sea: transparent for the ground texture (the water plane shows through), coloured on the minimap.
  const img = ctx.getImageData(0, 0, w, h);
  const [sr, sg, sb] = [0x1f, 0x6f, 0x78];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wx = BOUNDS.minX + (x + 0.5) * mpp;
      const wz = BOUNDS.minZ + (y + 0.5) * mpp;
      if (!isWater(wx, wz)) continue;
      const i = (y * w + x) * 4;
      if (opaqueSea) {
        img.data[i] = sr;
        img.data[i + 1] = sg;
        img.data[i + 2] = sb;
        img.data[i + 3] = 255;
      } else {
        img.data[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, w, h };
}

/* --------------------------------------------------------------------- write */

const out = PUBLIC_FAKE_DIR;
const files: Record<string, FileEntry> = {};
files['terrain.bin.gz'] = writeGz(resolve(out, 'terrain.bin.gz'), encodeTerrain(terrain));
files['buildings.bin.gz'] = writeGz(resolve(out, 'buildings.bin.gz'), encodeBuildings(buildings));
const ground = drawGround(GROUND_MPP, false, true);
files['ground.webp'] = writeFile(resolve(out, 'ground.webp'), await ground.canvas.encode('webp', 80));
const groundLo = drawGround(GROUND_LO_MPP, false, false);
files['ground-lo.webp'] = writeFile(resolve(out, 'ground-lo.webp'), await groundLo.canvas.encode('webp', 80));
const mmMpp = (BOUNDS.maxX - BOUNDS.minX) / MINIMAP_WIDTH;
const minimap = drawGround(mmMpp, true, false);
files['minimap.webp'] = writeFile(resolve(out, 'minimap.webp'), await minimap.canvas.encode('webp', 85));

// Close-up detail: the same loose grid of roads the ground image shows, as centre lines.
const RESIDENTIAL = ROAD_CLASSES.indexOf('residential');
const SECONDARY = ROAD_CLASSES.indexOf('secondary');
const fakeRoads: RoadWay[] = [];
const fakeRoad = (line: number[], n: number) => {
  // Every fourth road is a main one, so both kinds of marking can be seen.
  const main = n % 4 === 0;
  for (const part of clipLine(line, BOUNDS.minX + 1, BOUNDS.maxX - 1, BOUNDS.minZ + 1, BOUNDS.maxZ - 1)) {
    fakeRoads.push({ cls: main ? SECONDARY : RESIDENTIAL, flags: roadFlags(main ? 2 : 0, false, false), line: part });
  }
};
let roadNo = 0;
for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += 280) fakeRoad([x, BOUNDS.minZ, x + 120, BOUNDS.maxZ], roadNo++);
for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += 240) fakeRoad([BOUNDS.minX, z, BOUNDS.maxX, z + 90], roadNo++);
// Minor before major: the order they are painted in.
fakeRoads.sort((a, b) => a.cls - b.cls);
files['roads.bin.gz'] = writeGz(resolve(out, 'roads.bin.gz'), encodeRoads(fakeRoads));
const fakeRoadVertices = fakeRoads.reduce((n, r) => n + r.line.length / 2, 0);

let minH = Infinity;
let maxH = -Infinity;
for (const v of heights) {
  minH = Math.min(minH, v);
  maxH = Math.max(maxH, v);
}
const [west, south] = localToLonLat(BOUNDS.minX, BOUNDS.maxZ);
const [east, north] = localToLonLat(BOUNDS.maxX, BOUNDS.minZ);
let rings = 0;
let vertices = 0;
let maxHeight = 0;
for (const b of buildings) {
  rings += b.rings.length;
  for (const r of b.rings) vertices += r.length / 2;
  maxHeight = Math.max(maxHeight, b.topY - b.baseY);
}

const meta: MapMeta = {
  version: MAP_FORMAT_VERSION,
  generatedAt: new Date().toISOString(),
  fake: true,
  sources: {},
  attribution: ['Synthetic test world (not real data).', ...ATTRIBUTION.map((a) => `Real map will use: ${a}`)],
  crs: { epsg: 2193, originE: WORLD.originE, originN: WORLD.originN, trueNorthAngleRad: trueNorthAngleRad() },
  geo: fitGeo(),
  bounds: BOUNDS,
  latLonBounds: { south, west, north, east },
  water: { level: 0 },
  terrain: { file: 'terrain.bin.gz', cols, rows, cell: TERRAIN_CELL, minH, maxH },
  buildings: { file: 'buildings.bin.gz', count: buildings.length, rings, vertices, maxHeight },
  collision: { cell: COLLISION_CELL },
  ground: { file: 'ground.webp', loFile: 'ground-lo.webp', width: ground.w, height: ground.h, metresPerPixel: GROUND_MPP },
  minimap: { file: 'minimap.webp', width: minimap.w, height: minimap.h },
  landmarks: {
    skyTower: { x: skyTower.x, z: skyTower.z, groundY: groundAt(skyTower.x, skyTower.z), height: 328 },
    harbourBridge: {
      a: bridgeA,
      b: bridgeB,
      step,
      deckY,
      topY,
      archTop: { x: bridgeA.x + ux * topIdx * step, z: bridgeA.z + uz * topIdx * step, y: topY[topIdx] },
    },
    rangitoto: { x: rangitoto.x, z: rangitoto.z, summitY: 260, baseRadius: 2800 },
  },
  places: [
    ['CBD', -36.848, 174.764],
    ['Wynyard Quarter', -36.8405, 174.757],
    ['Freemans Bay', -36.8495, 174.7505],
    ['Ponsonby', -36.8545, 174.744],
    ['Grafton', -36.8615, 174.7685],
    ['Parnell', -36.8555, 174.7805],
    ['Newton', -36.862, 174.7555],
    ['Mount Eden', -36.8767, 174.7643],
    ['St Marys Bay', -36.8432, 174.747],
    ['Northcote Point', -36.8205, 174.7465],
    ['Devonport', -36.829, 174.795],
  ].map(([name, lat, lon]) => ({ name: name as string, kind: 'suburb', ...lonLatToLocal(lon as number, lat as number) })),
  detail: { roads: { file: 'roads.bin.gz', ways: fakeRoads.length, vertices: fakeRoadVertices } },
  files,
};

writeFile(resolve(out, 'meta.json'), JSON.stringify(meta, null, 1));
const total = Object.values(files).reduce((s, f) => s + f.bytes, 0);
console.log(
  `map-fake: ${buildings.length} buildings, terrain ${cols}x${rows}, ground ${ground.w}x${ground.h}, ` +
    `geo residual ${meta.geo.maxResidualM.toFixed(4)} m, total ${(total / 1024).toFixed(0)} KB`,
);
