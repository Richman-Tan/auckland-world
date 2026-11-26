import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FERRY_ROUTES, bridgeCruisePath, pathAt, routePath } from '../src/shared/ambientPaths';
import { BOAT_CAP, NEAR_RADIUS } from '../src/shared/detail';
import { BERTH, berthCorners, berthsFromLine, berthsFromPier, berthsOverlap, boatHalfBeam } from '../src/shared/harbour';
import { type Berth, type HarbourData, type MapMeta, decodeHarbour, decodeTerrain, encodeHarbour } from '../src/shared/mapFormat';
import { buildDetail } from '../src/world/buildDetail';
import { LAUNCH, PIER, YACHT, boatField, buildPierMesh } from '../src/world/harbour';
import { createNearSet } from '../src/world/nearSet';
import { INSTANCE_SIZE, TREE_SIZE, gatherTrees } from '../src/world/trees';

/** A pier running north from (x0, z0): a 3 m walkway with `fingers` fingers `reach` long down each side, 12 m apart. */
function comb(x0: number, z0: number, length: number, fingers: number, reach: number): number[] {
  const ring: number[] = [x0 + 1.5, z0];
  for (let k = 0; k < fingers; k++) {
    const zc = z0 - 14 - k * 12;
    ring.push(x0 + 1.5, zc + 0.6, x0 + 1.5 + reach, zc + 0.6, x0 + 1.5 + reach, zc - 0.6, x0 + 1.5, zc - 0.6);
  }
  ring.push(x0 + 1.5, z0 - length, x0 - 1.5, z0 - length);
  for (let k = fingers - 1; k >= 0; k--) {
    const zc = z0 - 14 - k * 12;
    ring.push(x0 - 1.5, zc - 0.6, x0 - 1.5 - reach, zc - 0.6, x0 - 1.5 - reach, zc + 0.6, x0 - 1.5, zc + 0.6);
  }
  ring.push(x0 - 1.5, z0);
  return ring;
}

describe('finding berths along a pier', () => {
  const ring = comb(0, 0, 80, 4, 10);
  const berths = berthsFromPier(ring);
  /** Beside one of the fingers, which here lie along z = -14, -26, -38 and -50. */
  const besideFinger = (b: Berth) => [-14, -26, -38, -50].some((zc) => Math.abs(b.z - zc) < 4);
  // Each end of the walkway is itself a tip between two long sides, so it gives a pair of berths
  // too. At sea that is a boat on the T-head; at the landward end it is on the shore, and whoever
  // calls this throws it out (the pipeline checks every berth against the sea, the piers and
  // each other).
  const fingers = berths.filter(besideFinger);

  it('puts a boat either side of every finger, lying along it', () => {
    expect(fingers).toHaveLength(16);
    for (const b of fingers) {
      // Fingers run east-west here, so the boats point east or west.
      expect(Math.abs(Math.sin(b.heading))).toBeCloseTo(1, 6);
      expect(b.length).toBeCloseTo(10 * BERTH.share, 6);
      // Half way along its finger, and clear of it by the gap.
      expect(Math.abs(b.x)).toBeCloseTo(1.5 + 5, 6);
      const finger = [-14, -26, -38, -50].find((zc) => Math.abs(b.z - zc) < 6)!;
      expect(Math.abs(b.z - finger)).toBeCloseTo(0.6 + BERTH.gap + boatHalfBeam(b.length), 6);
    }
    // Some lie bow in and some bow out.
    expect(new Set(fingers.map((b) => Math.round(Math.sin(b.heading)))).size).toBe(2);
  });

  it('finds the same berths whichever way the outline is drawn', () => {
    const reversed: number[] = [];
    for (let i = ring.length - 2; i >= 0; i -= 2) reversed.push(ring[i], ring[i + 1]);
    const key = (b: Berth) => `${b.x.toFixed(3)},${b.z.toFixed(3)}`;
    expect(berthsFromPier(reversed).map(key).sort()).toEqual(berths.map(key).sort());
  });

  it('leaves no two of the boats beside fingers touching, and none of them on the pier', () => {
    expect(berths).toHaveLength(16 + 4);
    for (let i = 0; i < fingers.length; i++) for (let j = i + 1; j < fingers.length; j++) expect(berthsOverlap(fingers[i], fingers[j]), `${i} and ${j}`).toBe(false);
    for (const b of fingers) {
      const c = berthCorners(b);
      for (let k = 0; k < 8; k += 2) {
        // Clear of the walkway (|x| < 1.5) and of every finger (within 0.6 of its line).
        expect(Math.abs(c[k])).toBeGreaterThan(1.5);
        for (const zc of [-14, -26, -38, -50]) expect(Math.abs(c[k + 1] - zc)).toBeGreaterThan(0.6);
      }
    }
  });

  it('finds none on a plain jetty, a short stub or a wide wharf', () => {
    expect(berthsFromPier([0, 0, 3, 0, 3, -40, 0, -40])).toEqual([]); // four corners: too simple to be a marina
    expect(berthsFromPier(comb(0, 0, 80, 4, 3)).filter(besideFinger)).toEqual([]); // fingers too short for a boat
    // Fingers 6 m wide are wharves, not fingers.
    const wide = [0, 0, 20, 0, 20, -6, 40, -6, 40, -12, 20, -12, 20, -30, 0, -30];
    expect(berthsFromPier(wide)).toEqual([]);
  });

  it('keeps boats between 6 and 18 m, however long the finger', () => {
    expect(berthsFromPier(comb(0, 0, 80, 4, 40)).filter(besideFinger)[0].length).toBe(BERTH.lengthMax);
    expect(berthsFromPier(comb(0, 0, 80, 4, 6.5)).filter(besideFinger)).toEqual([]);
  });

  it('treats a finger mapped as a single line the same way', () => {
    const two = berthsFromLine([0, 0, 12, 0], 2.2);
    expect(two).toHaveLength(2);
    expect(two[0].x).toBeCloseTo(6, 6);
    expect(Math.abs(two[0].z)).toBeCloseTo(1.1 + BERTH.gap + boatHalfBeam(two[0].length), 6);
    expect(two[0].z).toBeCloseTo(-two[1].z, 6);
    expect(berthsFromLine([0, 0, 3, 0], 2.2)).toEqual([]);
    expect(berthsFromLine([0, 0, 5, 0, 9, 0], 2.2)).toEqual([]);
  });

  it('knows when two boats would touch', () => {
    const a: Berth = { x: 0, z: 0, heading: 0, length: 10 };
    expect(berthsOverlap(a, { x: 2.9, z: 0, heading: 0, length: 10 })).toBe(true);
    expect(berthsOverlap(a, { x: 3.1, z: 0, heading: 0, length: 10 })).toBe(false);
    expect(berthsOverlap(a, { x: 0, z: 10.1, heading: 0, length: 10 })).toBe(false);
    // Across the bow, at right angles.
    expect(berthsOverlap(a, { x: 0, z: -6, heading: Math.PI / 2, length: 10 })).toBe(true);
    expect(berthsOverlap(a, { x: 0, z: -6.6, heading: Math.PI / 2, length: 10 })).toBe(false);
  });
});

describe('harbour.bin', () => {
  const data: HarbourData = {
    piers: [
      { ring: comb(100, -50, 80, 4, 10), floating: true },
      { ring: [-3000.25, 12.5, -2990, 12.5, -2990, 20.75, -3000.25, 20.75], floating: false },
    ],
    berths: [
      { x: 106.5, z: -61.75, heading: Math.PI / 2, length: 8.6 },
      { x: -2995.25, z: 30, heading: (3 * Math.PI) / 2, length: 17.3 },
    ],
  };

  it('round-trips piers and berths to a quarter of a metre', () => {
    const back = decodeHarbour(encodeHarbour(data));
    expect(back.piers).toHaveLength(2);
    expect(back.piers.map((p) => p.floating)).toEqual([true, false]);
    for (let p = 0; p < 2; p++) {
      expect(back.piers[p].ring).toHaveLength(data.piers[p].ring.length);
      for (let i = 0; i < data.piers[p].ring.length; i++) expect(Math.abs(back.piers[p].ring[i] - data.piers[p].ring[i])).toBeLessThanOrEqual(0.126);
    }
    expect(back.berths).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      expect(back.berths[i].x).toBeCloseTo(data.berths[i].x, 6);
      expect(back.berths[i].z).toBeCloseTo(data.berths[i].z, 6);
      expect(back.berths[i].length).toBeCloseTo(data.berths[i].length, 6);
      expect(Math.abs(back.berths[i].heading - data.berths[i].heading)).toBeLessThan((2 * Math.PI) / 256);
    }
  });

  it('refuses a file that is cut short or mislabelled, and a pier that is not a shape', () => {
    const bytes = encodeHarbour(data);
    expect(() => decodeHarbour(bytes.slice(0, bytes.length - 12))).toThrow(/Truncated/);
    const bad = bytes.slice();
    bad[0] = 0x58;
    expect(() => decodeHarbour(bad)).toThrow(/magic/);
    expect(() => encodeHarbour({ piers: [{ ring: [0, 0, 1, 1], floating: false }], berths: [] })).toThrow(/pier/);
  });
});

describe('drawing piers and boats', () => {
  const data: HarbourData = { piers: [{ ring: [0, 0, 10, 0, 10, -4, 0, -4], floating: true }, { ring: [20, 0, 20, -4, 30, -4, 30, 0], floating: false }], berths: [] };
  const mesh = buildPierMesh(data, 0);

  it('raises each outline into a deck with a skirt, the deck facing up and the skirt out', () => {
    // A rectangle: two triangles of deck and eight of skirt.
    expect(mesh.triangles).toBe(20);
    expect(mesh.colors.length).toBe(mesh.triangles * 3 * 4);
    const centres = [[5, -2], [25, -2]];
    for (let t = 0; t < mesh.triangles; t++) {
      const p = [0, 1, 2].map((k) => [mesh.positions[(t * 3 + k) * 3], mesh.positions[(t * 3 + k) * 3 + 1], mesh.positions[(t * 3 + k) * 3 + 2]]);
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const c = centres[t < 10 ? 0 : 1];
      const mx = (p[0][0] + p[1][0] + p[2][0]) / 3;
      const mz = (p[0][2] + p[1][2] + p[2][2]) / 3;
      const top = t < 10 ? PIER.floatingDeck : PIER.fixedDeck;
      if (p.every((q) => Math.abs(q[1] - top) < 1e-6)) expect(n[1]).toBeGreaterThan(0);
      else {
        expect(Math.abs(n[1])).toBeLessThan(1e-6);
        expect(n[0] * (mx - c[0]) + n[2] * (mz - c[1])).toBeGreaterThan(0);
        expect(Math.min(...p.map((q) => q[1]))).toBeCloseTo(-PIER.skirt, 6);
      }
    }
  });

  it('stands a pontoon lower than a pier on piles', () => {
    let floating = -Infinity;
    let fixed = -Infinity;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      if (mesh.positions[v * 3] <= 10) floating = Math.max(floating, mesh.positions[v * 3 + 1]);
      else fixed = Math.max(fixed, mesh.positions[v * 3 + 1]);
    }
    expect(floating).toBeCloseTo(PIER.floatingDeck, 6);
    expect(fixed).toBeCloseTo(PIER.fixedDeck, 6);
  });

  it('makes a field of boats on the waterline, by tile, yachts and launches both', () => {
    const berths: Berth[] = [];
    for (let i = 0; i < 400; i++) berths.push({ x: -190 + (i % 20) * 19, z: -190 + Math.floor(i / 20) * 19, heading: (i % 8) * (Math.PI / 4), length: 8 + (i % 5) });
    const bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
    const f = boatField({ piers: [], berths }, bounds, 0.4, 200);
    expect(f.count).toBe(400);
    expect(f.tiles.nx * f.tiles.nz).toBe(4);
    const kinds = [0, 0];
    for (let i = 0; i < f.count; i++) {
      expect(f.trees[i * TREE_SIZE + 1]).toBeCloseTo(0.4, 6);
      kinds[f.look[i * 2]]++;
    }
    expect(kinds[YACHT]).toBeGreaterThan(kinds[LAUNCH]);
    expect(kinds[LAUNCH]).toBeGreaterThan(60);
    // The heading survives as a byte: 256 to the turn.
    const set = createNearSet(f.tiles);
    set.update(0, 0, 500);
    const out = [new Float32Array(400 * INSTANCE_SIZE), new Float32Array(400 * INSTANCE_SIZE)];
    const n = gatherTrees(f, set.tiles, 0, 0, 400, out);
    expect(n[0] + n[1]).toBe(400);
    for (let k = 0; k < n[0]; k++) expect(out[0][k * INSTANCE_SIZE + 4] % 32).toBe(0);
  });
});

describe('the harbour on the fake map', () => {
  const dir = new URL('../public/map-fake/', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8')) as MapMeta;

  it('is listed, and comes out of the detail worker as a pier mesh and a field of boats', async () => {
    const bytes = new Uint8Array(readFileSync(new URL(meta.detail!.harbour!.file, dir)));
    const data = decodeHarbour(new Uint8Array(gunzipSync(bytes)));
    expect(meta.detail?.harbour).toEqual({ file: 'harbour.bin.gz', piers: data.piers.length, vertices: data.piers.reduce((n, p) => n + p.ring.length / 2, 0), berths: data.berths.length });
    expect(data.berths.length).toBeGreaterThan(10);
    const terrain = decodeTerrain(new Uint8Array(gunzipSync(readFileSync(new URL(meta.terrain.file, dir)))));
    const out = await buildDetail({ harbour: bytes, terrain, bounds: meta.bounds, quality: 'high', waterLevel: meta.water.level });
    expect(out.piers!.triangles).toBeGreaterThan(100);
    expect(out.boats!.count).toBe(data.berths.length);
    expect(out.ribbons).toBeUndefined();
    expect(out.land).toBeUndefined();
  });
});

const realDir = new URL('../public/map/', import.meta.url);
describe.runIf(existsSync(new URL('harbour.bin.gz', realDir)))('the harbour on the real map', () => {
  const meta = JSON.parse(readFileSync(new URL('meta.json', realDir), 'utf8')) as MapMeta;
  const data = decodeHarbour(new Uint8Array(gunzipSync(readFileSync(new URL('harbour.bin.gz', realDir)))));

  it('has about three hundred piers and fifteen hundred boats, most of them at Westhaven', () => {
    expect(data.piers.length).toBeGreaterThan(200);
    expect(data.berths.length).toBeGreaterThan(1200);
    expect(data.berths.length).toBeLessThan(2400);
    const westhaven = { x: -1450, z: -1150 };
    const there = data.berths.filter((b) => Math.hypot(b.x - westhaven.x, b.z - westhaven.z) < 700).length;
    expect(there / data.berths.length).toBeGreaterThan(0.5);
  });

  it('keeps every boat clear of every other', () => {
    for (let i = 0; i < data.berths.length; i++) {
      for (let j = i + 1; j < data.berths.length; j++) {
        const a = data.berths[i];
        const b = data.berths[j];
        if (Math.abs(a.x - b.x) > 20 || Math.abs(a.z - b.z) > 20) continue;
        expect(berthsOverlap(a, b), `boats ${i} and ${j}`).toBe(false);
      }
    }
  });

  it('leaves the ferries and the bridge cruise a clear way through', () => {
    const paths = [...FERRY_ROUTES.map((r) => routePath(meta.geo, r)), bridgeCruisePath(meta.landmarks.harbourBridge)];
    // The least water between any point of any route and the nearest boat's end.
    let clear = Infinity;
    for (const path of paths) {
      for (let s = 0; s <= path.length; s += 6) {
        const p = pathAt(path, s);
        for (const b of data.berths) clear = Math.min(clear, Math.hypot(b.x - p.x, b.z - p.z) - b.length / 2);
      }
    }
    expect(clear).toBeGreaterThan(10);
  });

  it('never draws more boats than the cap, and its piers fit the triangle budget', () => {
    const f = boatField(data, meta.bounds, meta.water.level);
    const set = createNearSet(f.tiles);
    set.update(-1450, -1150, NEAR_RADIUS.boats);
    const n = gatherTrees(f, set.tiles, -1450, -1150, BOAT_CAP, [new Float32Array(BOAT_CAP * INSTANCE_SIZE), new Float32Array(BOAT_CAP * INSTANCE_SIZE)]);
    expect(n[0] + n[1]).toBe(BOAT_CAP);
    expect(buildPierMesh(data, 0).triangles).toBeLessThan(30_000);
  });
});
