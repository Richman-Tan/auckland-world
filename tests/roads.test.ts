import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { clipLine } from '../scripts/lib/geom';
import { type Bounds, type MapMeta, type RoadWay, type TerrainGrid, decodeRoads, decodeTerrain, encodeRoads, sampleTerrain } from '../src/shared/mapFormat';
import { LANE_WIDTH, RAIL, ROAD_BRIDGE, ROAD_CLASSES, ROAD_ONEWAY, arterial, carriagewayHalfWidth, centreLined, footpathWidth, lanesOf, roadFlags, roadLanes } from '../src/shared/roads';
import { buildDetail, detailTransferables } from '../src/world/buildDetail';
import { createNearSet, gatherIndices, tileDistance } from '../src/world/nearSet';
import { INFO_MARKED, INFO_ONEWAY, buildRibbons, ribbonLift, tileGrid, tileOf } from '../src/world/ribbons';
import { buildTerrainMesh, sampleTerrainMesh } from '../src/world/terrainMesh';
import { rng } from './flightWorld';

const cls = (name: (typeof ROAD_CLASSES)[number]) => ROAD_CLASSES.indexOf(name);
const BOUNDS: Bounds = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
const flat = () => 5;

describe('road tables', () => {
  it('packs lanes, direction and bridge into one byte', () => {
    const f = roadFlags(3, true, true);
    expect(roadLanes(f)).toBe(3);
    expect(f & ROAD_ONEWAY).toBeTruthy();
    expect(f & ROAD_BRIDGE).toBeTruthy();
    expect(roadFlags(0, false, false)).toBe(0);
    expect(roadLanes(roadFlags(99, false, false))).toBe(15);
    expect(roadLanes(roadFlags(-2, false, false))).toBe(0);
  });

  it('uses recorded lanes, and guesses sensibly without them', () => {
    expect(lanesOf(cls('primary'), roadFlags(4, false, false))).toBe(4);
    expect(lanesOf(cls('residential'), 0)).toBe(2);
    expect(lanesOf(cls('residential'), roadFlags(0, true, false))).toBe(1);
    expect(lanesOf(cls('motorway'), roadFlags(0, true, false))).toBe(2);
    expect(lanesOf(cls('service'), 0)).toBe(1);
  });

  it('sizes roads by their lanes: a wider road for every lane, a footpath on streets only', () => {
    const two = carriagewayHalfWidth(cls('residential'), 0);
    const four = carriagewayHalfWidth(cls('primary'), roadFlags(4, false, false));
    expect(two * 2).toBeGreaterThan(2 * LANE_WIDTH);
    expect(two * 2).toBeLessThan(2 * LANE_WIDTH + 2);
    expect(four - two).toBeCloseTo(LANE_WIDTH, 6);
    expect(carriagewayHalfWidth(cls('service'), 0)).toBeLessThan(two);
    expect(footpathWidth(cls('residential'))).toBe(2);
    expect(footpathWidth(cls('secondary'))).toBe(2);
    for (const c of ['service', 'motorway', 'motorway_link', 'trunk', 'rail'] as const) expect(footpathWidth(cls(c)), c).toBe(0);
    expect(RAIL).toBe(15);
  });

  it('paints a centre line on collectors and up, edge lines on arterials, neither on rail', () => {
    expect(centreLined(cls('residential'))).toBe(false);
    expect(centreLined(cls('tertiary'))).toBe(true);
    expect(arterial(cls('tertiary'))).toBe(false);
    expect(arterial(cls('secondary'))).toBe(true);
    expect(arterial(cls('motorway'))).toBe(true);
    expect(centreLined(RAIL)).toBe(false);
    expect(arterial(RAIL)).toBe(false);
  });
});

describe('roads.bin', () => {
  const ways: RoadWay[] = [
    { cls: cls('service'), flags: 0, line: [0, 0, 10.25, -3.5, 20, 4] },
    { cls: cls('motorway'), flags: roadFlags(3, true, true), line: [-3599, -3999, 3599, 3999] },
    { cls: RAIL, flags: 0, line: [5, 5, 5.25, 5, 5.5, 5.25, 100, 200, -100, -200] },
  ];

  it('round-trips ways to a quarter of a metre', () => {
    const d = decodeRoads(encodeRoads(ways));
    expect(d.count).toBe(3);
    expect(d.vertexCount).toBe(10);
    expect([...d.cls]).toEqual(ways.map((w) => w.cls));
    expect([...d.flags]).toEqual(ways.map((w) => w.flags));
    expect([...d.wayStart]).toEqual([0, 3, 5, 10]);
    ways.forEach((w, i) => {
      const got = [...d.xz.subarray(d.wayStart[i] * 2, d.wayStart[i + 1] * 2)];
      expect(got).toHaveLength(w.line.length);
      got.forEach((v, k) => expect(Math.abs(v - (w.line[k] as number))).toBeLessThanOrEqual(0.125 + 1e-6));
    });
  });

  it('handles an empty network, and refuses nonsense', () => {
    const empty = decodeRoads(encodeRoads([]));
    expect(empty.count).toBe(0);
    expect([...empty.wayStart]).toEqual([0]);
    expect(() => encodeRoads([{ cls: 0, flags: 0, line: [1, 2] }])).toThrow();
    expect(() => encodeRoads([{ cls: 0, flags: 0, line: [1, 2, 3] }])).toThrow();
    expect(() => decodeRoads(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]))).toThrow(/magic/);
    const bytes = encodeRoads(ways);
    expect(() => decodeRoads(bytes.slice(0, bytes.length - 12))).toThrow();
  });
});

describe('clipping a road to the map', () => {
  const clip = (line: number[]) => clipLine(line, -10, 10, -10, 10);
  it('keeps what is inside untouched', () => {
    expect(clip([0, 0, 5, 5, -5, 2])).toEqual([[0, 0, 5, 5, -5, 2]]);
  });
  it('cuts exactly at the edge, both going out and coming in', () => {
    expect(clip([0, 0, 20, 0])).toEqual([[0, 0, 10, 0]]);
    expect(clip([-20, 5, 0, 5])).toEqual([[-10, 5, 0, 5]]);
    expect(clip([-20, 0, 20, 0])).toEqual([[-10, 0, 10, 0]]);
  });
  it('splits a road that leaves and comes back', () => {
    expect(clip([0, 0, 20, 0, 20, 5, 0, 5])).toEqual([[0, 0, 10, 0], [10, 5, 0, 5]]);
  });
  it('drops what never comes in', () => {
    expect(clip([20, 20, 30, 30])).toEqual([]);
    expect(clip([20, 0, 20, 5])).toEqual([]);
    expect(clip([5, 5])).toEqual([]);
  });
});

describe('height on the drawn terrain', () => {
  // A bumpy little grid, so every cell is twisted.
  const random = rng(5);
  const grid: TerrainGrid = { cols: 9, rows: 7, cell: 20, x0: -80, z0: -60, minH: 0, maxH: 30, heights: Float32Array.from({ length: 63 }, () => random() * 30) };
  const bounds: Bounds = { minX: -80, maxX: 80, minZ: -60, maxZ: 60 };

  for (const stride of [1, 2, 3]) {
    it(`matches the mesh's own triangles at stride ${stride}`, () => {
      const mesh = buildTerrainMesh(grid, bounds, stride);
      const P = (v: number) => [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
      // Every vertex, every triangle's centroid and every edge midpoint lies on the sampled surface.
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const [a, b, c] = [P(mesh.indices[i]), P(mesh.indices[i + 1]), P(mesh.indices[i + 2])];
        for (const [u, v, w] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0.2, 0.1, 0.7]]) {
          const x = a[0] * u + b[0] * v + c[0] * w;
          const y = a[1] * u + b[1] * v + c[1] * w;
          const z = a[2] * u + b[2] * v + c[2] * w;
          expect(sampleTerrainMesh(grid, x, z, stride)).toBeCloseTo(y, 4);
        }
      }
    });
  }

  it('is not the same thing as the bilinear sample inside a twisted cell', () => {
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const x = -80 + random() * 160;
      const z = -60 + random() * 120;
      worst = Math.max(worst, Math.abs(sampleTerrainMesh(grid, x, z) - sampleTerrain(grid, x, z)));
    }
    expect(worst).toBeGreaterThan(0.5);
  });

  it('clamps outside the grid', () => {
    expect(sampleTerrainMesh(grid, -500, -500)).toBeCloseTo(grid.heights[0], 6);
    expect(sampleTerrainMesh(grid, 500, 500)).toBeCloseTo(grid.heights[62], 6);
  });
});

describe('road ribbons', () => {
  const street = decodeRoads(encodeRoads([{ cls: cls('secondary'), flags: roadFlags(2, false, false), line: [0, 0, 100, 0] }]));

  it('makes a strip as wide as the road and its footpaths, lying on the ground', () => {
    const m = buildRibbons(street, flat, BOUNDS);
    const n = m.positions.length / 3;
    expect(n % 2).toBe(0);
    const edge = carriagewayHalfWidth(cls('secondary'), roadFlags(2, false, false)) + footpathWidth(cls('secondary'));
    for (let v = 0; v < n; v++) {
      expect(Math.abs(m.positions[v * 3 + 2])).toBeCloseTo(edge, 5);
      expect(m.positions[v * 3 + 1]).toBeCloseTo(5 + ribbonLift(cls('secondary')), 5);
      expect(Math.abs(m.across[v])).toBeCloseTo(edge, 5);
      expect(m.half[v]).toBeCloseTo(edge - 2, 5);
      expect(m.info[v * 4]).toBe(cls('secondary'));
      expect(m.info[v * 4 + 1]).toBe(2);
      expect(m.info[v * 4 + 3]).toBe(20);
    }
    // Stations no more than 12 m apart: 100 m needs at least nine stretches.
    expect(n / 2).toBeGreaterThanOrEqual(10);
    expect(m.indices.length).toBe((n / 2 - 1) * 6);
  });

  it('measures distance along the way, the same on both edges', () => {
    const m = buildRibbons(street, flat, BOUNDS);
    let prev = -1;
    for (let v = 0; v < m.along.length; v += 2) {
      expect(m.along[v]).toBe(m.along[v + 1]);
      expect(m.along[v]).toBeGreaterThan(prev);
      expect(m.along[v]).toBeCloseTo(m.positions[v * 3], 4);
      prev = m.along[v];
    }
    expect(prev).toBeCloseTo(100, 4);
  });

  it('faces every triangle up', () => {
    const bendy = decodeRoads(encodeRoads([{ cls: cls('residential'), flags: 0, line: [0, 0, 40, 0, 40, 60, -30, 90, -30, -50] }]));
    const m = buildRibbons(bendy, flat, BOUNDS);
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, c] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((v) => [m.positions[v * 3], m.positions[v * 3 + 2]]);
      // y component of (b - a) x (c - a) for points in the x-z plane.
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      expect(ny, `triangle ${i / 3}`).toBeGreaterThan(0);
    }
  });

  it('follows the ground under each edge, not just the centre line', () => {
    const tilted = (x: number, z: number) => 10 + z * 0.2 + x * 0.01;
    const m = buildRibbons(street, tilted, BOUNDS);
    for (let v = 0; v < m.positions.length / 3; v++) {
      const [x, y, z] = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
      expect(y - tilted(x, z)).toBeCloseTo(ribbonLift(cls('secondary')), 5);
    }
  });

  it('paints no lines close to a way\'s ends, and marks one-way roads', () => {
    const m = buildRibbons(street, flat, BOUNDS);
    for (let v = 0; v < m.along.length; v++) {
      const marked = (m.info[v * 4 + 2] & INFO_MARKED) !== 0;
      expect(marked).toBe(m.along[v] > 7 && m.along[v] < 93);
      expect(m.info[v * 4 + 2] & INFO_ONEWAY).toBe(0);
    }
    const ramp = decodeRoads(encodeRoads([{ cls: cls('motorway_link'), flags: roadFlags(1, true, false), line: [0, 0, 50, 0] }]));
    const r = buildRibbons(ramp, flat, BOUNDS);
    expect(r.info[2] & INFO_ONEWAY).toBe(INFO_ONEWAY);
  });

  it('lifts bigger roads above smaller ones, by enough for the depth buffer to tell', () => {
    const order = ['service', 'residential', 'secondary', 'motorway'] as const;
    for (let i = 1; i < order.length; i++) expect(ribbonLift(cls(order[i])) - ribbonLift(cls(order[i - 1]))).toBeGreaterThanOrEqual(0.06);
    expect(ribbonLift(RAIL)).toBeGreaterThan(ribbonLift(cls('service')));
    expect(ribbonLift(cls('motorway'))).toBeLessThan(0.5);
  });

  it('groups triangles by tile, and can leave the smallest roads out', () => {
    const net = decodeRoads(
      encodeRoads([
        { cls: cls('service'), flags: 0, line: [-900, -900, -700, -900] },
        { cls: cls('primary'), flags: 0, line: [-900, 0, 900, 0] },
      ]),
    );
    const m = buildRibbons(net, flat, BOUNDS, { tileSize: 500 });
    expect(m.tiles).toEqual({ x0: -1000, z0: -1000, size: 500, nx: 4, nz: 4 });
    expect(m.tileStart).toHaveLength(17);
    expect(m.tileStart[16]).toBe(m.indices.length);
    // Each tile's triangles really are in it (by the middle of the stretch they belong to).
    for (let t = 0; t < 16; t++) {
      for (let i = m.tileStart[t]; i < m.tileStart[t + 1]; i += 6) {
        const vs = [...m.indices.subarray(i, i + 6)];
        const cx = vs.reduce((s, v) => s + m.positions[v * 3], 0) / 6;
        const cz = vs.reduce((s, v) => s + m.positions[v * 3 + 2], 0) / 6;
        expect(tileOf(m.tiles, cx, cz)).toBe(t);
      }
    }
    // The primary road crosses all four columns of one row.
    const row = tileOf(m.tiles, 0, 1);
    for (let i = 0; i < 4; i++) expect(m.tileStart[row - (row % 4) + i + 1]).toBeGreaterThan(m.tileStart[row - (row % 4) + i]);
    const lean = buildRibbons(net, flat, BOUNDS, { minClass: cls('living_street') });
    expect(lean.indices.length).toBeLessThan(m.indices.length);
    expect([...lean.info].filter((_, k) => k % 4 === 0).every((c) => c === cls('primary'))).toBe(true);
  });
});

describe('tiles near the camera', () => {
  const grid = tileGrid(BOUNDS, 500);

  it('measures distance to a tile, zero inside it', () => {
    expect(tileDistance(grid, 0, -900, -900)).toBe(0);
    expect(tileDistance(grid, 0, -400, -900)).toBe(100);
    expect(tileDistance(grid, 0, -400, -400)).toBeCloseTo(Math.hypot(100, 100), 6);
    expect(tileOf(grid, 5000, 5000)).toBe(15);
    expect(tileOf(grid, -5000, -5000)).toBe(0);
  });

  it('takes every tile within the radius, in order', () => {
    const near = createNearSet(grid);
    expect(near.update(-750, -750, 100)).toBe(true);
    expect(near.tiles).toEqual([0]);
    expect(near.update(-750, -750, 100)).toBe(false);
    expect(near.update(0, 0, 100)).toBe(true);
    expect(near.tiles).toEqual([5, 6, 9, 10]);
    expect(near.update(0, 0, 5000)).toBe(true);
    expect(near.tiles).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it('does not flicker along a boundary', () => {
    const near = createNearSet(grid, 150);
    near.update(-600, -750, 100);
    expect(near.tiles).toEqual([0, 1]);
    // Step away from tile 1: it stays until it is the slack further off, then goes.
    expect(near.update(-700, -750, 100)).toBe(false);
    expect(near.update(-740, -750, 100)).toBe(false);
    expect(near.update(-760, -750, 100)).toBe(true);
    expect(near.tiles).toEqual([0]);
    // Coming back, it only returns once it is properly within the radius.
    expect(near.update(-700, -750, 100)).toBe(false);
    expect(near.update(-599, -750, 100)).toBe(true);
    expect(near.tiles).toEqual([0, 1]);
  });

  it('empties when the radius is zero', () => {
    const near = createNearSet(grid);
    near.update(0, 0, 300);
    expect(near.update(0, 0, 0)).toBe(true);
    expect(near.tiles).toEqual([]);
    expect(near.update(0, 0, 0)).toBe(false);
  });

  it('gathers the chosen tiles\' triangles to the front of a buffer', () => {
    const indices = Uint32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const tileStart = Uint32Array.from([0, 3, 3, 9]);
    const out = new Uint32Array(9);
    expect(gatherIndices(indices, tileStart, [0, 2], out)).toBe(9);
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(gatherIndices(indices, tileStart, [2], out)).toBe(6);
    expect([...out.subarray(0, 6)]).toEqual([4, 5, 6, 7, 8, 9]);
    expect(gatherIndices(indices, tileStart, [1], out)).toBe(0);
    expect(gatherIndices(indices, tileStart, [], out)).toBe(0);
  });
});

const real = new URL('../public/map/', import.meta.url);
describe.runIf(existsSync(new URL('meta.json', real)) && existsSync(new URL('roads.bin.gz', real)))('the real road network', () => {
  const meta = JSON.parse(readFileSync(new URL('meta.json', real), 'utf8')) as MapMeta;
  const roads = decodeRoads(new Uint8Array(gunzipSync(readFileSync(new URL('roads.bin.gz', real)))));
  const terrain = decodeTerrain(new Uint8Array(gunzipSync(readFileSync(new URL(meta.terrain.file, real)))));

  it('is what the map says it is', () => {
    expect(meta.detail?.roads).toEqual({ file: 'roads.bin.gz', ways: roads.count, vertices: roads.vertexCount });
    expect(roads.count).toBeGreaterThan(5000);
    expect(new Set(roads.cls).has(RAIL)).toBe(true);
    expect(new Set(roads.cls).has(cls('motorway'))).toBe(true);
    // Painting order: once rail starts, nothing else follows; before it, classes never go down.
    for (let w = 1; w < roads.count; w++) expect(roads.cls[w]).toBeGreaterThanOrEqual(roads.cls[w - 1]);
  });

  it('becomes ribbons that sit just above the terrain everywhere', () => {
    const height = (x: number, z: number) => sampleTerrainMesh(terrain, x, z, 1);
    const m = buildRibbons(roads, height, meta.bounds);
    const n = m.positions.length / 3;
    expect(n).toBeGreaterThan(100_000);
    expect(n).toBeLessThan(400_000);
    let worstLow = Infinity;
    let worstHigh = -Infinity;
    for (let v = 0; v < n; v += 7) {
      const gap = m.positions[v * 3 + 1] - height(m.positions[v * 3], m.positions[v * 3 + 2]);
      worstLow = Math.min(worstLow, gap);
      worstHigh = Math.max(worstHigh, gap);
    }
    expect(worstLow).toBeGreaterThan(0.1);
    expect(worstHigh).toBeLessThan(0.5);
    // A handful of tiles is a small share of the whole: this is what keeps the cost down.
    const near = createNearSet(m.tiles);
    near.update(-90, -88, 700);
    const out = new Uint32Array(m.indices.length);
    const drawn = gatherIndices(m.indices, m.tileStart, near.tiles, out) / 3;
    expect(drawn).toBeGreaterThan(1000);
    expect(drawn).toBeLessThan(60_000);
    expect(drawn).toBeLessThan((m.indices.length / 3) * 0.25);
  });
});

describe('close-up detail on the fake map', () => {
  const dir = new URL('../public/map-fake/', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8')) as MapMeta;
  const terrain = decodeTerrain(new Uint8Array(gunzipSync(readFileSync(new URL(meta.terrain.file, dir)))));
  const roadBytes = () => new Uint8Array(readFileSync(new URL(meta.detail!.roads!.file, dir)));

  it('lists its roads the way the real map does', () => {
    const roads = decodeRoads(new Uint8Array(gunzipSync(roadBytes())));
    expect(meta.detail?.roads).toEqual({ file: 'roads.bin.gz', ways: roads.count, vertices: roads.vertexCount });
    expect(meta.files['roads.bin.gz'].bytes).toBe(roadBytes().length);
    expect(roads.count).toBeGreaterThan(20);
  });

  it('builds road ribbons from the gzipped file, as the worker does', async () => {
    const out = await buildDetail({ roads: roadBytes(), terrain, bounds: meta.bounds, quality: 'high' });
    expect(out.ribbons).toBeDefined();
    const m = out.ribbons!;
    expect(m.indices.length).toBeGreaterThan(1000);
    expect(m.positions.length / 3).toBe(m.along.length);
    expect(m.info.length).toBe(m.along.length * 4);
    expect(detailTransferables(out)).toHaveLength(7);
    // On the ground, as the high tier draws it.
    for (let v = 0; v < m.along.length; v += 11) {
      const gap = m.positions[v * 3 + 1] - sampleTerrainMesh(terrain, m.positions[v * 3], m.positions[v * 3 + 2], 1);
      expect(gap).toBeGreaterThan(0.1);
      expect(gap).toBeLessThan(0.5);
    }
  });

  it('follows the coarser ground of the low tier, and is nothing at all without a roads file', async () => {
    const low = await buildDetail({ roads: roadBytes(), terrain, bounds: meta.bounds, quality: 'low' });
    const m = low.ribbons!;
    for (let v = 0; v < m.along.length; v += 11) {
      const gap = m.positions[v * 3 + 1] - sampleTerrainMesh(terrain, m.positions[v * 3], m.positions[v * 3 + 2], 2);
      expect(gap).toBeGreaterThan(0.1);
      expect(gap).toBeLessThan(0.5);
    }
    const none = await buildDetail({ terrain, bounds: meta.bounds, quality: 'high' });
    expect(none.ribbons).toBeUndefined();
    expect(detailTransferables(none)).toEqual([]);
  });
});
