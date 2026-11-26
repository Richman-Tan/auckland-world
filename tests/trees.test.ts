import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NEAR_RADIUS, TREE_CAP, detailLadder } from '../src/shared/detail';
import { CANOPY_LOW, CANOPY_MID, CANOPY_TALL, CANOPY_TYPICAL, type LandGrid, landCellAt } from '../src/shared/land';
import { type MapMeta, decodeLand, decodeTerrain } from '../src/shared/mapFormat';
import { pohutukawaBloom } from '../src/shared/timeOfDay';
import { buildDetail, detailTransferables } from '../src/world/buildDetail';
import { createNearSet } from '../src/world/nearSet';
import { sampleTerrainMesh } from '../src/world/terrainMesh';
import {
  BROADLEAF,
  INSTANCE_SIZE,
  PINE,
  POHUTUKAWA,
  SPECIES,
  TREE_DENSITY,
  TREE_SIZE,
  cellHash,
  gatherTrees,
  scatterTrees,
  speciesFor,
  treeShape,
} from '../src/world/trees';

const bounds = { minX: -300, maxX: 300, minZ: -300, maxZ: 300 };
/** A 100 x 100 grid of 6 m cells: canopy of one class everywhere, or by a rule. */
function grid(canopyAt: (c: number, r: number) => number): LandGrid {
  const g: LandGrid = { width: 100, height: 100, cell: 6, cls: new Uint8Array(10_000), canopy: new Uint8Array(10_000) };
  for (let r = 0; r < 100; r++) for (let c = 0; c < 100; c++) g.canopy[r * 100 + c] = canopyAt(c, r);
  return g;
}
const flat = () => 12;

describe('choosing by a cell', () => {
  it('gives the same number for the same cell and salt, spread evenly from 0 to 1', () => {
    expect(cellHash(3, 9, 1)).toBe(cellHash(3, 9, 1));
    expect(cellHash(3, 9, 1)).not.toBe(cellHash(9, 3, 1));
    expect(cellHash(3, 9, 1)).not.toBe(cellHash(3, 9, 2));
    const tenths = new Array<number>(10).fill(0);
    for (let c = 0; c < 200; c++) for (let r = 0; r < 200; r++) tenths[Math.floor(cellHash(c, r, 7) * 10)]++;
    for (const n of tenths) {
      expect(n).toBeGreaterThan(3600);
      expect(n).toBeLessThan(4400);
    }
  });

  it('puts pohutukawa by the sea, pines where the canopy is tall, broadleaves everywhere', () => {
    const share = (canopy: number, coastal: boolean) => {
      const n = [0, 0, 0];
      for (let i = 0; i < 1000; i++) n[speciesFor(canopy, coastal, (i + 0.5) / 1000)]++;
      return n.map((v) => v / 1000);
    };
    expect(share(CANOPY_MID, true)[POHUTUKAWA]).toBeGreaterThan(0.5);
    expect(share(CANOPY_MID, false)[POHUTUKAWA]).toBeLessThan(0.1);
    expect(share(CANOPY_TALL, false)[PINE]).toBeGreaterThan(0.15);
    expect(share(CANOPY_LOW, false)[PINE]).toBeLessThan(0.05);
    for (const k of [CANOPY_LOW, CANOPY_MID, CANOPY_TALL]) expect(share(k, false)[BROADLEAF]).toBeGreaterThan(0.6);
  });
});

describe('standing trees in the canopy', () => {
  it('stands them only where there is canopy, about as densely as asked, each inside its own cell', () => {
    const land = grid((c) => (c < 50 ? CANOPY_MID : 0));
    const f = scatterTrees(land, bounds, flat);
    expect(f.count).toBeGreaterThan(5000 * TREE_DENSITY[CANOPY_MID] * 0.9);
    expect(f.count).toBeLessThan(5000 * TREE_DENSITY[CANOPY_MID] * 1.1);
    const seen = new Set<number>();
    for (let i = 0; i < f.count; i++) {
      const [x, y, z] = [f.trees[i * TREE_SIZE], f.trees[i * TREE_SIZE + 1], f.trees[i * TREE_SIZE + 2]];
      const cell = landCellAt(land, bounds.minX, bounds.minZ, x, z);
      expect(land.canopy[cell]).toBe(CANOPY_MID);
      // One tree a cell at most, and not on its edge.
      expect(seen.has(cell)).toBe(false);
      seen.add(cell);
      const fx = ((x - bounds.minX) / 6) % 1;
      expect(fx).toBeGreaterThan(0.16);
      expect(fx).toBeLessThan(0.84);
      expect(y).toBe(12);
    }
  });

  it('makes them as tall as the canopy, pines taller and pohutukawa lower', () => {
    for (const k of [CANOPY_LOW, CANOPY_MID, CANOPY_TALL]) {
      const f = scatterTrees(grid(() => k), bounds, flat);
      for (let i = 0; i < f.count; i++) {
        const h = f.trees[i * TREE_SIZE + 3];
        const s = f.look[i * 2];
        const scale = s === PINE ? 1.35 : s === POHUTUKAWA ? 0.85 : 1;
        expect(h).toBeGreaterThanOrEqual(CANOPY_TYPICAL[k] * 0.8 * scale - 1e-4);
        expect(h).toBeLessThanOrEqual(CANOPY_TYPICAL[k] * 1.2 * scale + 1e-4);
      }
    }
  });

  it('plants nothing in the sea, and pohutukawa along the shore', () => {
    // Sea east of x = 0.
    const ground = (x: number) => (x > 0 ? -3 : 9);
    const f = scatterTrees(grid(() => CANOPY_MID), bounds, ground);
    let coast = 0;
    let coastPohutukawa = 0;
    let inlandPohutukawa = 0;
    let inland = 0;
    for (let i = 0; i < f.count; i++) {
      const x = f.trees[i * TREE_SIZE];
      expect(x).toBeLessThan(0);
      const p = f.look[i * 2] === POHUTUKAWA ? 1 : 0;
      if (x > -60) {
        coast++;
        coastPohutukawa += p;
      } else if (x < -100) {
        inland++;
        inlandPohutukawa += p;
      }
    }
    expect(coastPohutukawa / coast).toBeGreaterThan(0.45);
    expect(inlandPohutukawa / inland).toBeLessThan(0.15);
  });

  it('is the same wood every time, grouped by tile', () => {
    const land = grid((c, r) => ((c * 7 + r * 3) % 5 === 0 ? CANOPY_TALL : (c + r) % 3 === 0 ? CANOPY_LOW : 0));
    const a = scatterTrees(land, bounds, flat, { tileSize: 150 });
    const b = scatterTrees(land, bounds, flat, { tileSize: 150 });
    expect(Array.from(a.trees)).toEqual(Array.from(b.trees));
    expect(Array.from(a.look)).toEqual(Array.from(b.look));
    expect(a.tiles.nx * a.tiles.nz).toBe(16);
    expect(a.tileStart[a.tileStart.length - 1]).toBe(a.count);
    for (let t = 0; t < 16; t++) {
      expect(a.tileStart[t + 1]).toBeGreaterThanOrEqual(a.tileStart[t]);
      const i0 = t % 4;
      const j0 = Math.floor(t / 4);
      for (let i = a.tileStart[t]; i < a.tileStart[t + 1]; i++) {
        expect(Math.floor((a.trees[i * TREE_SIZE] - bounds.minX) / 150)).toBe(i0);
        expect(Math.floor((a.trees[i * TREE_SIZE + 2] - bounds.minZ) / 150)).toBe(j0);
      }
    }
  });
});

describe('gathering the nearest trees', () => {
  const f = scatterTrees(grid(() => CANOPY_MID), bounds, flat, { tileSize: 150 });
  const all = Array.from({ length: 16 }, (_, t) => t);
  const buffers = (n: number) => SPECIES.map(() => new Float32Array(n * INSTANCE_SIZE));

  it('sorts them into a buffer a species, with place, height and seed', () => {
    const out = buffers(f.count);
    const n = gatherTrees(f, all, 0, 0, f.count, out);
    expect(n.reduce((a, b) => a + b, 0)).toBe(f.count);
    for (let s = 0; s < SPECIES.length; s++) {
      let want = 0;
      for (let i = 0; i < f.count; i++) if (f.look[i * 2] === s) want++;
      expect(n[s]).toBe(want);
      for (let k = 0; k < n[s]; k++) {
        expect(out[s][k * INSTANCE_SIZE + 1]).toBe(12);
        expect(out[s][k * INSTANCE_SIZE + 3]).toBeGreaterThan(5);
        expect(out[s][k * INSTANCE_SIZE + 4]).toBeLessThan(256);
      }
    }
  });

  it('stops at the cap, having taken the nearest tiles first', () => {
    const out = buffers(400);
    const n = gatherTrees(f, all, -225, -225, 400, out);
    expect(n.reduce((a, b) => a + b, 0)).toBe(400);
    // Tile 0 is the one the camera is over; all 400 come from it and its neighbours.
    for (let s = 0; s < SPECIES.length; s++) {
      for (let k = 0; k < n[s]; k++) {
        expect(out[s][k * INSTANCE_SIZE]).toBeLessThan(bounds.minX + 300);
        expect(out[s][k * INSTANCE_SIZE + 2]).toBeLessThan(bounds.minZ + 300);
      }
    }
    expect(gatherTrees(f, all, 0, 0, 0, buffers(10))).toEqual([0, 0, 0]);
    expect(gatherTrees(f, [], 0, 0, 100, buffers(10))).toEqual([0, 0, 0]);
  });

  it('never writes past the end of a buffer', () => {
    const out = buffers(5);
    const n = gatherTrees(f, all, 0, 0, 10_000, out);
    for (const c of n) expect(c).toBeLessThanOrEqual(5);
  });
});

describe('the three kinds of tree', () => {
  it.each(SPECIES.map((name, s) => [name, s] as const))('%s: a trunk and a crown, one unit tall, every face turned outward', (_name, s) => {
    const shape = treeShape(s);
    expect(shape.triangles).toBeGreaterThanOrEqual(20);
    expect(shape.triangles).toBeLessThanOrEqual(32);
    expect(shape.positions.length).toBe(shape.triangles * 9);
    expect(shape.tone.length).toBe(shape.triangles * 3);
    let top = 0;
    let trunk = 0;
    let widest = 0;
    for (let t = 0; t < shape.triangles; t++) {
      const p = [0, 1, 2].map((k) => [shape.positions[(t * 3 + k) * 3], shape.positions[(t * 3 + k) * 3 + 1], shape.positions[(t * 3 + k) * 3 + 2]]);
      const tones = [0, 1, 2].map((k) => shape.tone[t * 3 + k]);
      // A triangle is all trunk or all crown.
      expect(new Set(tones.map((v) => v === 0)).size).toBe(1);
      if (tones[0] === 0) trunk++;
      else for (const v of tones) {
        expect(v).toBeGreaterThan(0.6);
        expect(v).toBeLessThan(1.3);
      }
      for (const q of p) {
        expect(q[1]).toBeGreaterThanOrEqual(0);
        expect(q[1]).toBeLessThanOrEqual(1);
        top = Math.max(top, q[1]);
        widest = Math.max(widest, Math.hypot(q[0], q[2]));
      }
      // Its normal points away from the trunk (or straight up or down, on the axis).
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const c = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];
      expect(Math.hypot(...n)).toBeGreaterThan(1e-6);
      expect(n[0] * c[0] + n[2] * c[1]).toBeGreaterThan(-1e-6);
    }
    expect(top).toBeCloseTo(1, 6);
    expect(trunk).toBe(6);
    // A pohutukawa is as broad as it is tall; a pine is narrow.
    if (s === POHUTUKAWA) expect(widest).toBeGreaterThan(0.45);
    if (s === PINE) expect(widest).toBeLessThan(0.25);
  });
});

describe('pohutukawa in flower', () => {
  const at = (iso: string) => pohutukawaBloom(new Date(iso));

  it('flowers for Christmas and not in winter', () => {
    expect(at('2026-12-25T00:00:00Z')).toBe(1);
    expect(at('2027-01-05T00:00:00Z')).toBe(1);
    for (const off of ['2026-07-01T00:00:00Z', '2026-03-15T00:00:00Z', '2026-10-31T00:00:00Z', '2027-02-10T00:00:00Z', '2026-11-10T00:00:00Z']) expect(at(off), off).toBe(0);
  });

  it('comes on through late November and fades through January', () => {
    const early = at('2026-11-27T00:00:00Z');
    expect(early).toBeGreaterThan(0.05);
    expect(early).toBeLessThan(0.5);
    expect(at('2026-12-03T00:00:00Z')).toBeGreaterThan(early);
    const late = at('2027-01-22T00:00:00Z');
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
    expect(at('2027-01-28T00:00:00Z')).toBeLessThan(late);
  });

  it('carries straight on over the new year, and goes by the date in Auckland', () => {
    expect(at('2026-12-31T10:00:00Z')).toBe(1); // 11 pm on the 31st in Auckland
    expect(at('2026-12-31T12:00:00Z')).toBe(1); // 1 am on the 1st
    // Never jumps by more than a day's worth from one day to the next.
    let prev = at('2026-10-01T00:00:00Z');
    for (let d = 1; d < 200; d++) {
      const v = pohutukawaBloom(new Date(Date.UTC(2026, 9, 1 + d)));
      expect(Math.abs(v - prev)).toBeLessThan(0.07);
      prev = v;
    }
  });
});

describe('trees and the detail ladder', () => {
  it('draws fewer of them, nearer, on each rung down, and none on the last', () => {
    for (const tier of ['high', 'low'] as const) {
      const ladder = detailLadder(tier);
      for (let i = 1; i < ladder.length; i++) expect(ladder[i].props * ladder[i].near).toBeLessThanOrEqual(ladder[i - 1].props * ladder[i - 1].near);
      expect(ladder[ladder.length - 1].props).toBe(0);
    }
    expect(Math.round(TREE_CAP * detailLadder('high')[0].props)).toBe(TREE_CAP);
    expect(NEAR_RADIUS.trees).toBeLessThan(NEAR_RADIUS.ground);
  });
});

describe('trees on the fake map', () => {
  const dir = new URL('../public/map-fake/', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8')) as MapMeta;

  it('come out of the detail worker with the land, standing on dry ground', async () => {
    const terrain = decodeTerrain(new Uint8Array(gunzipSync(readFileSync(new URL(meta.terrain.file, dir)))));
    const out = await buildDetail({ land: new Uint8Array(readFileSync(new URL(meta.detail!.land!.file, dir))), terrain, bounds: meta.bounds, quality: 'high', waterLevel: meta.water.level });
    const f = out.trees!;
    expect(f.count).toBeGreaterThan(1000);
    for (let i = 0; i < f.count; i += 13) {
      const [x, y, z] = [f.trees[i * TREE_SIZE], f.trees[i * TREE_SIZE + 1], f.trees[i * TREE_SIZE + 2]];
      // (To a centimetre: the tree's place is kept as 32-bit numbers.)
      expect(y).toBeCloseTo(sampleTerrainMesh(terrain, x, z, 1), 2);
      expect(y).toBeGreaterThan(meta.water.level);
    }
    expect(detailTransferables(out)).toContain(f.trees.buffer);
  });
});

const realDir = new URL('../public/map/', import.meta.url);
describe.runIf(existsSync(new URL('land.bin.gz', realDir)))('trees on the real map', () => {
  const meta = JSON.parse(readFileSync(new URL('meta.json', realDir), 'utf8')) as MapMeta;
  const terrain = decodeTerrain(new Uint8Array(gunzipSync(readFileSync(new URL(meta.terrain.file, realDir)))));
  const land = decodeLand(new Uint8Array(gunzipSync(readFileSync(new URL('land.bin.gz', realDir)))));
  const f = scatterTrees(land, meta.bounds, (x, z) => sampleTerrainMesh(terrain, x, z, 1), { waterLevel: meta.water.level });

  it('stands about seventy thousand of them, mostly broadleaf, with pines and pohutukawa among them', () => {
    expect(f.count).toBeGreaterThan(55_000);
    expect(f.count).toBeLessThan(90_000);
    const by = [0, 0, 0];
    for (let i = 0; i < f.count; i++) by[f.look[i * 2]]++;
    expect(by[BROADLEAF] / f.count).toBeGreaterThan(0.75);
    expect(by[PINE]).toBeGreaterThan(1500);
    expect(by[POHUTUKAWA]).toBeGreaterThan(3000);
  });

  it('never draws more than the cap, even in the Domain, and stays inside the triangle budget', () => {
    const tris = SPECIES.map((_, s) => treeShape(s).triangles);
    for (const [x, z] of [[1250, 1250], [40, 3000], [-1700, 1200], [-90, -88]]) {
      const set = createNearSet(f.tiles);
      set.update(x, z, NEAR_RADIUS.trees);
      const n = gatherTrees(f, set.tiles, x, z, TREE_CAP, SPECIES.map(() => new Float32Array(TREE_CAP * INSTANCE_SIZE)));
      expect(n.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(TREE_CAP);
      expect(n.reduce((a, c, s) => a + c * tris[s], 0)).toBeLessThan(50_000);
    }
  });
});
