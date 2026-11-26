/**
 * land.bin: what the ground is, cell by cell, and the tree canopy over it (src/shared/land.ts).
 * The ground image already paints these areas, but as colour at three metres a pixel; this keeps
 * what each one is, so the ground near the plane can be drawn as grass, sand, yards or a car park,
 * and so trees can stand where trees really are.
 *
 * Classes come from the same OpenStreetMap areas, in the same order, as the ground image, so the
 * two agree. Canopy comes from LiDAR: where the surface stands well above the ground, is not a
 * building, a road or the sea, and is as rough as foliage (a roof, a bridge deck or a stack of
 * containers is high but smooth).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import {
  CANOPY_HEIGHTS,
  CANOPY_MIN_COVER,
  LAND_CELL,
  LAND_CLASSES,
  LAND_COLOUR,
  type LandGrid,
  canopyClass,
  landCode,
} from '../../src/shared/land';
import { encodeLand } from '../../src/shared/mapFormat';
import { GROUND, hexToRgb } from '../../src/shared/palette';
import { ROAD_CLASSES, type RoadClass, carriagewayHalfWidth, roadFlags } from '../../src/shared/roads';
import { BOUNDS, PUBLIC_MAP_DIR } from '../config';
import { writeFile, writeGz } from '../lib/io';
import { loadOsm, polygonsOf } from '../lib/osm';
import { DEBUG_DIR, WORK, ensure } from '../lib/paths';
import { dilate, fillPolygon, median, stampLine } from '../lib/raster';
import { areaFeatures, inlandWater, transport } from './ground';
import { MH, MW, loadMosaic } from './mosaic';
import { downsampleMajority, loadWater } from './water';

export const LW = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / LAND_CELL); // 1200
export const LH = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / LAND_CELL); // 1334

/** Classes are painted on a finer grid and each cell takes the commonest, so thin shapes survive. */
const SUB = 3;
/** Nothing taller than this is a tree here: cranes, masts and pylons are. */
const MAX_TREE_M = 45;
/** How far the 3 x 3 neighbourhood of a surface sample strays from a flat (or sloping) plane, metres, before it counts as rough. */
const ROUGH_M = 0.22;
/**
 * The share of a cell's high samples that must be rough for it to be foliage rather than a roof.
 * Measured on this map (land.json, roughShareOfHighCells): nine in ten high cells in mapped woodland
 * are over 0.7, while the container terminal is spread evenly from 0 to 1. So 0.7 makes a tree; a
 * cell between the two counts only with trees on at least three sides (a gap in a wood); and on
 * industrial land, where the stacks are, nothing short of 0.9 does.
 */
const ROUGH_SHARE = 0.7;
const ROUGH_SHARE_WEAK = 0.45;
const ROUGH_SHARE_INDUSTRIAL = 0.9;
/** Buildings and roads are kept clear of canopy by this margin, metres. */
const BUILDING_MARGIN = 2;
const ROAD_MARGIN = 1;
/** A sea cell this close to land takes the land's class, so the shore is drawn as what it borders. */
const SHORE_CELLS = 3;

const toGrid = (ring: ArrayLike<number>, mpp: number): number[] => {
  const out = new Array<number>(ring.length);
  for (let i = 0; i < ring.length; i += 2) {
    out[i] = (ring[i] - BOUNDS.minX) / mpp;
    out[i + 1] = (ring[i + 1] - BOUNDS.minZ) / mpp;
  }
  return out;
};

/** The class of every cell, from the mapped areas. */
function classes(): Uint8Array {
  const mpp = LAND_CELL / SUB;
  const w = LW * SUB;
  const h = LH * SUB;
  const fine = new Uint8Array(w * h); // 0 = 'land'
  const paint = (rings: number[][], code: number) => fillPolygon(fine, w, h, rings.map((r) => toGrid(r, mpp)), code);
  const parking = landCode('parking');
  // The ground image's order: zones, then green space, then woods, then sand and rock; within a
  // layer the larger area first, so a small one inside a big one is not painted over.
  for (const layer of [2, 3, 4, 5]) {
    for (const f of areaFeatures()) {
      if (f.layer !== layer || landCode(f.kind) === parking) continue;
      for (const p of f.polys) paint(p.rings, landCode(f.kind));
    }
  }
  // Car parks last of the land: one inside a park is still a car park.
  for (const f of areaFeatures()) if (landCode(f.kind) === parking) for (const p of f.polys) paint(p.rings, parking);
  const iw = inlandWater();
  for (const p of iw.polys) paint(p.rings, landCode('water'));
  for (const l of iw.lines) if (l.width >= LAND_CELL) stampLine(fine, w, h, toGrid(l.line, mpp), l.width / 2 / mpp, landCode('water'));

  const out = new Uint8Array(LW * LH);
  const votes = new Uint8Array(LAND_CLASSES.length);
  for (let r = 0; r < LH; r++) {
    for (let c = 0; c < LW; c++) {
      votes.fill(0);
      for (let dr = 0; dr < SUB; dr++) for (let dc = 0; dc < SUB; dc++) votes[fine[(r * SUB + dr) * w + c * SUB + dc]]++;
      let best = 0;
      for (let k = 1; k < votes.length; k++) if (votes[k] > votes[best]) best = k;
      out[r * LW + c] = best;
    }
  }
  return out;
}

/** Sea cells near the shore take the class of the nearest land, a ring at a time. */
function spreadIntoSea(cls: Uint8Array, sea: Uint8Array) {
  let known = new Uint8Array(LW * LH);
  for (let i = 0; i < known.length; i++) known[i] = sea[i] && cls[i] === 0 ? 0 : 1;
  for (let pass = 0; pass < SHORE_CELLS; pass++) {
    const next = known.slice();
    for (let r = 0; r < LH; r++) {
      for (let c = 0; c < LW; c++) {
        const i = r * LW + c;
        if (known[i]) continue;
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= LW || rr >= LH || !known[rr * LW + cc]) continue;
          cls[i] = cls[rr * LW + cc];
          next[i] = 1;
          break;
        }
      }
    }
    known = next;
  }
}

/** Where a tree cannot be, at the LiDAR's one metre: buildings and carriageways, with a margin. */
function noTreeMask(): Uint8Array {
  const built = new Uint8Array(MW * MH);
  for (const el of loadOsm('buildings').elements) {
    if (!el.tags?.building && !el.tags?.['building:part']) continue;
    // The outline only: a courtyard is part of the building as far as a tree count goes.
    for (const p of polygonsOf(el)) fillPolygon(built, MW, MH, [toGrid(p.rings[0], 1)], 1);
  }
  const mask = dilate(built, MW, MH, BUILDING_MARGIN);
  const { roads, rails } = transport();
  for (const r of roads) {
    const cls = ROAD_CLASSES.indexOf(r.cls as RoadClass);
    if (cls < 0) continue;
    stampLine(mask, MW, MH, toGrid(r.line, 1), carriagewayHalfWidth(cls, roadFlags(r.lanes, r.oneway, r.bridge)) + ROAD_MARGIN, 1);
  }
  for (const line of rails) stampLine(mask, MW, MH, toGrid(line, 1), 2.5 + ROAD_MARGIN, 1);
  return mask;
}

/** Canopy class of every cell, from the LiDAR surface and ground models. */
async function canopy(sea: Uint8Array, cls: Uint8Array): Promise<{ plane: Uint8Array; highSamples: number; treeSamples: number; roughShare: Record<string, number[]> }> {
  // How rough the high cells of each kind of land are, in tenths: what the thresholds were set from.
  const roughShare: Record<string, number[]> = Object.fromEntries(LAND_CLASSES.map((k) => [k, new Array<number>(10).fill(0)]));
  const dem = (await loadMosaic('dem')).data;
  const dsm = (await loadMosaic('dsm')).data;
  const blocked = noTreeMask();
  const plane = new Uint8Array(LW * LH);
  /** Cells too smooth to be sure of: their class if a tree, kept for the second pass. */
  const maybe = new Uint8Array(LW * LH);
  const industrial = landCode('industrial');
  const heights: number[] = [];
  let highSamples = 0;
  let treeSamples = 0;
  const cell = LAND_CELL;
  for (let r = 0; r < LH; r++) {
    for (let c = 0; c < LW; c++) {
      if (sea[r * LW + c]) continue;
      heights.length = 0;
      let high = 0;
      let rough = 0;
      let total = 0;
      for (let pr = r * cell; pr < Math.min(MH, (r + 1) * cell); pr++) {
        for (let pc = c * cell; pc < Math.min(MW, (c + 1) * cell); pc++) {
          total++;
          const i = pr * MW + pc;
          const h = dsm[i] - dem[i];
          if (!(h >= CANOPY_HEIGHTS[0]) || h > MAX_TREE_M || blocked[i]) continue;
          high++;
          heights.push(h);
          if (pr < 1 || pc < 1 || pr >= MH - 1 || pc >= MW - 1) continue;
          // Least-squares plane through the 3 x 3 neighbourhood, and how far the samples sit from it.
          let sum = 0;
          let gx = 0;
          let gz = 0;
          let ok = true;
          for (let dr = -1; dr <= 1 && ok; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const v = dsm[i + dr * MW + dc];
              if (!Number.isFinite(v)) {
                ok = false;
                break;
              }
              sum += v;
              gx += v * dc;
              gz += v * dr;
            }
          }
          if (!ok) continue;
          const mean = sum / 9;
          const bx = gx / 6;
          const bz = gz / 6;
          let err = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const d = dsm[i + dr * MW + dc] - (mean + bx * dc + bz * dr);
              err += d * d;
            }
          }
          if (Math.sqrt(err / 9) > ROUGH_M) rough++;
        }
      }
      highSamples += high;
      if (total === 0 || high < CANOPY_MIN_COVER * total) continue;
      roughShare[LAND_CLASSES[cls[r * LW + c]]][Math.min(9, Math.floor((10 * rough) / high))]++;
      const kind = canopyClass(median(heights));
      const need = cls[r * LW + c] === industrial ? ROUGH_SHARE_INDUSTRIAL : ROUGH_SHARE;
      if (rough >= need * high) {
        treeSamples += high;
        plane[r * LW + c] = kind;
      } else if (rough >= ROUGH_SHARE_WEAK * high && cls[r * LW + c] !== industrial) {
        maybe[r * LW + c] = kind;
      }
    }
  }
  // The doubtful cells: canopy if the cells around them mostly are.
  const sure = plane.slice();
  for (let r = 1; r < LH - 1; r++) {
    for (let c = 1; c < LW - 1; c++) {
      const i = r * LW + c;
      if (!maybe[i]) continue;
      let around = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (sure[i + dr * LW + dc]) around++;
      if (around >= 5) plane[i] = maybe[i];
    }
  }
  // On industrial land a lone rough cell or a pair is machinery (a straddle carrier, a light
  // mast), not a tree: trees there come in rows and clumps.
  const before = plane.slice();
  for (let r = 1; r < LH - 1; r++) {
    for (let c = 1; c < LW - 1; c++) {
      const i = r * LW + c;
      if (!before[i] || cls[i] !== industrial) continue;
      let around = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (before[i + dr * LW + dc]) around++;
      if (around < 4) plane[i] = 0;
    }
  }
  return { plane, highSamples, treeSamples, roughShare };
}

function debugImage(g: LandGrid, sea: Uint8Array) {
  const canvas = createCanvas(g.width, g.height);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(g.width, g.height);
  const colours = LAND_CLASSES.map((k) => hexToRgb(GROUND[LAND_COLOUR[k]]).map((v) => Math.round(v * 255)));
  const tree = [[0, 0, 0], [86, 140, 60], [40, 104, 44], [16, 70, 36]];
  for (let i = 0; i < g.width * g.height; i++) {
    const c = sea[i] ? [31, 111, 120] : g.canopy[i] ? tree[g.canopy[i]] : colours[g.cls[i]];
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ensure(DEBUG_DIR);
  writeFileSync(resolve(DEBUG_DIR, 'land.png'), canvas.toBuffer('image/png'));
}

export async function buildLand() {
  const sea = downsampleMajority(loadWater().mask, 4);
  if (sea.w !== LW || sea.h !== LH) throw new Error(`6 m sea mask ${sea.w}x${sea.h} != land ${LW}x${LH}`);
  const cls = classes();
  spreadIntoSea(cls, sea.data);
  const trees = await canopy(sea.data, cls);
  const grid: LandGrid = { width: LW, height: LH, cell: LAND_CELL, cls, canopy: trees.plane };
  const entry = writeGz(resolve(PUBLIC_MAP_DIR, 'land.bin.gz'), encodeLand(grid));
  debugImage(grid, sea.data);

  let land = 0;
  let canopyCells = 0;
  const byClass = new Array<number>(LAND_CLASSES.length).fill(0);
  const canopyBy = [0, 0, 0, 0];
  const canopyIn = new Array<number>(LAND_CLASSES.length).fill(0);
  for (let i = 0; i < LW * LH; i++) {
    if (sea.data[i]) continue;
    land++;
    byClass[cls[i]]++;
    if (trees.plane[i]) {
      canopyCells++;
      canopyBy[trees.plane[i]]++;
      canopyIn[cls[i]]++;
    }
  }
  const pct = (n: number, of: number) => Math.round((1000 * n) / Math.max(1, of)) / 10;
  const report = {
    width: LW,
    height: LH,
    cell: LAND_CELL,
    bytes: entry.bytes,
    landCells: land,
    classPct: Object.fromEntries(LAND_CLASSES.map((k, i) => [k, pct(byClass[i], land)])),
    canopyPct: pct(canopyCells, land),
    canopyByHeightPct: { low: pct(canopyBy[1], canopyCells), mid: pct(canopyBy[2], canopyCells), tall: pct(canopyBy[3], canopyCells) },
    canopyWithinClassPct: Object.fromEntries(LAND_CLASSES.map((k, i) => [k, pct(canopyIn[i], byClass[i])])),
    highSamples: trees.highSamples,
    treeSamples: trees.treeSamples,
    roughShareOfHighCells: trees.roughShare,
  };
  writeFile(resolve(WORK, 'land.json'), JSON.stringify(report, null, 1));
  console.log(
    `land: ${LW}x${LH} at ${LAND_CELL} m, ${(entry.bytes / 1024).toFixed(0)} KB gz, canopy over ${report.canopyPct}% of the land ` +
      `(low ${report.canopyByHeightPct.low}%, mid ${report.canopyByHeightPct.mid}%, tall ${report.canopyByHeightPct.tall}%)`,
  );
  return report;
}
