/**
 * harbour.bin: the piers, and the berths along them (src/shared/harbour.ts). The ground image
 * paints a pier as a few specks of land; this keeps its real outline, so it can be drawn as a
 * deck over the water with boats moored beside it.
 *
 * Piers come from OpenStreetMap (man_made=pier): outlines as they are, single lines widened into
 * narrow decks. Berths are worked out from the outlines' fingers, then kept only where a boat
 * would really float: its whole length over the sea, clear of every pier and of every boat already
 * placed, and out of the way of the ferries.
 */
import { resolve } from 'node:path';
import { type Berth, type HarbourData, type Pier, encodeHarbour } from '../../src/shared/mapFormat';
import { berthCorners, berthsFromLine, berthsFromPier, berthsOverlap } from '../../src/shared/harbour';
import { BOUNDS, PUBLIC_MAP_DIR } from '../config';
import { douglasPeucker, pointInRing, signedArea } from '../lib/geom';
import { writeFile, writeGz } from '../lib/io';
import { lineOf, loadOsm } from '../lib/osm';
import { WORK } from '../lib/paths';
import { isSea, loadWater } from './water';

/** A pier mapped as a line is drawn this wide. */
const LINE_WIDTH = 2.2;
/** Outlines are simplified to this, metres: finer than a finger is wide. */
const SIMPLIFY_M = 0.3;
/** A pier smaller than this is not worth a mesh. */
const MIN_AREA = 8;
/** One berth in this many is left empty. */
const EMPTY = 0.18;

const inBounds = (x: number, z: number) => x > BOUNDS.minX + 5 && x < BOUNDS.maxX - 5 && z > BOUNDS.minZ + 5 && z < BOUNDS.maxZ - 5;

/** A line as a narrow closed deck: out along one side and back along the other. */
function widen(line: number[], width: number): number[] {
  const n = line.length / 2;
  /** The point `side` half-widths to the left of the line at vertex i. */
  const beside = (i: number, side: number): [number, number] => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = line[b * 2] - line[a * 2];
    let dz = line[b * 2 + 1] - line[a * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    return [line[i * 2] - dz * (width / 2) * side, line[i * 2 + 1] + dx * (width / 2) * side];
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(...beside(i, 1));
  for (let i = n - 1; i >= 0; i--) out.push(...beside(i, -1));
  return out;
}

function hash01(x: number, z: number): number {
  let h = (Math.imul(Math.round(x * 4), 0x9e3779b1) ^ Math.imul(Math.round(z * 4), 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export async function buildHarbour() {
  const { mask } = loadWater();
  const piers: Pier[] = [];
  const candidates: Berth[] = [];
  let lines = 0;
  for (const el of loadOsm('water').elements) {
    if (el.type !== 'way' || el.tags?.man_made !== 'pier' || !el.geometry) continue;
    const raw = lineOf(el);
    const n = raw.length / 2;
    if (n < 2) continue;
    const closed = n > 3 && Math.hypot(raw[0] - raw[n * 2 - 2], raw[1] - raw[n * 2 - 1]) < 0.01;
    const floating = el.tags.floating === 'yes';
    let ring: number[];
    if (closed) {
      ring = douglasPeucker(raw.slice(0, -2), SIMPLIFY_M);
      // Simplifying an open run can leave its two ends on top of each other.
      if (ring.length >= 4 && Math.hypot(ring[0] - ring[ring.length - 2], ring[1] - ring[ring.length - 1]) < 0.01) ring = ring.slice(0, -2);
      candidates.push(...berthsFromPier(ring));
    } else {
      ring = widen(raw, LINE_WIDTH);
      if (n === 2) candidates.push(...berthsFromLine(raw, LINE_WIDTH));
      lines++;
    }
    if (ring.length < 6 || Math.abs(signedArea(ring)) < MIN_AREA) continue;
    let inside = true;
    for (let i = 0; i < ring.length; i += 2) if (!inBounds(ring[i], ring[i + 1])) inside = false;
    if (!inside) continue;
    piers.push({ ring, floating });
  }

  // Keep a berth only where a boat would float: over the sea from end to end, on no pier, and
  // touching no boat already kept.
  const berths: Berth[] = [];
  const dropped = { land: 0, pier: 0, overlap: 0, empty: 0 };
  const cell = 24;
  const buckets = new Map<string, Berth[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const boxes = piers.map((p) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.ring.length; i += 2) {
      minX = Math.min(minX, p.ring[i]);
      maxX = Math.max(maxX, p.ring[i]);
      minZ = Math.min(minZ, p.ring[i + 1]);
      maxZ = Math.max(maxZ, p.ring[i + 1]);
    }
    return { minX, maxX, minZ, maxZ };
  });
  candidates.sort((a, b) => a.x - b.x || a.z - b.z);
  for (const found of candidates) {
    // Checked where it will actually be drawn: the file keeps places to a quarter of a metre.
    const b: Berth = { ...found, x: Math.round(found.x * 4) / 4, z: Math.round(found.z * 4) / 4 };
    const corners = berthCorners(b);
    const probes = [b.x, b.z, ...corners, (corners[0] + corners[2]) / 2, (corners[1] + corners[3]) / 2, (corners[4] + corners[6]) / 2, (corners[5] + corners[7]) / 2];
    let ok = true;
    for (let i = 0; i < probes.length && ok; i += 2) if (!inBounds(probes[i], probes[i + 1])) ok = false;
    if (!ok) continue;
    // The sea mask counts a pier's own specks as land, so the middle of the boat decides; it is
    // the piers themselves that the corners are checked against.
    if (!isSea(mask, b.x, b.z)) {
      dropped.land++;
      continue;
    }
    let onPier = false;
    for (let p = 0; p < piers.length && !onPier; p++) {
      const box = boxes[p];
      if (b.x < box.minX - 12 || b.x > box.maxX + 12 || b.z < box.minZ - 12 || b.z > box.maxZ + 12) continue;
      for (let i = 0; i < probes.length; i += 2) if (pointInRing(probes[i], probes[i + 1], piers[p].ring)) onPier = true;
    }
    if (onPier) {
      dropped.pier++;
      continue;
    }
    let clash = false;
    const cx = Math.floor(b.x / cell);
    const cz = Math.floor(b.z / cell);
    for (let i = cx - 1; i <= cx + 1 && !clash; i++) for (let j = cz - 1; j <= cz + 1 && !clash; j++) for (const other of buckets.get(`${i},${j}`) ?? []) if (berthsOverlap(b, other)) clash = true;
    if (clash) {
      dropped.overlap++;
      continue;
    }
    // The berth is taken up either way, so a neighbour cannot slide into an empty one.
    const list = buckets.get(key(b.x, b.z)) ?? [];
    list.push(b);
    buckets.set(key(b.x, b.z), list);
    if (hash01(b.x, b.z) < EMPTY) {
      dropped.empty++;
      continue;
    }
    berths.push(b);
  }

  const data: HarbourData = { piers, berths };
  const entry = writeGz(resolve(PUBLIC_MAP_DIR, 'harbour.bin.gz'), encodeHarbour(data));
  const vertices = piers.reduce((n, p) => n + p.ring.length / 2, 0);
  const report = { piers: piers.length, fromLines: lines, vertices, floating: piers.filter((p) => p.floating).length, candidates: candidates.length, berths: berths.length, dropped, bytes: entry.bytes };
  writeFile(resolve(WORK, 'harbour.json'), JSON.stringify(report, null, 1));
  console.log(`harbour: ${piers.length} piers (${vertices} vertices), ${berths.length} boats in ${candidates.length} berths found (${dropped.land} on land, ${dropped.pier} on a pier, ${dropped.overlap} overlapping, ${dropped.empty} left empty), ${(entry.bytes / 1024).toFixed(0)} KB gz`);
  return report;
}
