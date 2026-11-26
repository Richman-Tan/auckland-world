import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildCollisionGrid } from '../src/shared/collision';
import { type BuildingRecord, decodeBuildings, decodeTerrain, encodeBuildings } from '../src/shared/mapFormat';
import { makeStyle } from '../src/shared/palette';
import { PITCHED, PLANT_ROOM, boundingRectangle, buildingSeed, pitchedStyle, plantRoom, roofPlan, seeded } from '../src/shared/roofs';
import { PLANT_ROOM_STYLE, STYLE_SIZE, extrudeBuildings } from '../src/world/extrude';

const bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
/** A rectangle w (east-west) by d (north-south) with its south-west corner at (x, z), counter-clockwise on a north-up map. */
const rect = (x: number, z: number, w: number, d: number) => [x, z, x + w, z, x + w, z - d, x, z - d];
const HOUSE = makeStyle(6, 0); // weatherboard under red iron
const TOWER = makeStyle(0, 5); // glass under flat concrete
const build = (list: BuildingRecord[]) => decodeBuildings(encodeBuildings(list));

/** A seed that gives the roof kind asked for on a long rectangle. */
function seedFor(kind: 'hip' | 'gable'): number {
  for (let s = 0; s < 256; s++) if (roofPlan(rect(0, 0, 14, 8), 7, s, true).kind === kind) return s;
  throw new Error(`no seed gives a ${kind} roof`);
}

describe('the smallest rectangle round a footprint', () => {
  it('finds the long axis of a rectangle however it is turned', () => {
    const r = boundingRectangle(rect(10, 5, 14, 8));
    expect(r.halfLength).toBeCloseTo(7, 6);
    expect(r.halfWidth).toBeCloseTo(4, 6);
    expect([r.cx, r.cz]).toEqual([17, 1]);
    expect(Math.abs(r.ux)).toBeCloseTo(1, 6);
    expect(r.area).toBeCloseTo(112, 6);
    // Turned 30 degrees: the same rectangle, the axis turned with it.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const turned = rect(-7, 4, 14, 8).map((_, i, a) => (i % 2 === 0 ? a[i] * c - a[i + 1] * s : a[i - 1] * s + a[i] * c));
    const t = boundingRectangle(turned);
    expect(t.halfLength).toBeCloseTo(7, 5);
    expect(t.halfWidth).toBeCloseTo(4, 5);
    expect(Math.abs(t.ux * c + t.uz * s)).toBeCloseTo(1, 5);
  });
});

describe('working out a roof', () => {
  it('gives a house a hip or a gable, with the ridge along the long side and over the building', () => {
    for (const kind of ['hip', 'gable'] as const) {
      const p = roofPlan(rect(0, 0, 14, 8), 7, seedFor(kind), true);
      expect(p.kind).toBe(kind);
      // Along the middle of the 14 m side.
      expect(p.a[1]).toBeCloseTo(-4, 6);
      expect(p.b[1]).toBeCloseTo(-4, 6);
      const ridge = Math.abs(p.b[0] - p.a[0]);
      if (kind === 'hip') expect(ridge).toBeCloseTo(14 - 8, 6);
      else expect(ridge).toBeGreaterThan(13);
      for (const x of [p.a[0], p.b[0]]) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(14);
      }
      // A pitch between 22 and 32 degrees over half the 8 m width.
      expect(p.rise).toBeGreaterThan(4 * Math.tan((22 * Math.PI) / 180) - 1e-6);
      expect(p.rise).toBeLessThan(4 * Math.tan((32 * Math.PI) / 180) + 1e-6);
      // Two corners run to each end.
      expect(Array.from(p.end).sort()).toEqual([0, 0, 1, 1]);
    }
  });

  it('brings a square roof to a point', () => {
    const p = roofPlan(rect(0, 0, 9, 9), 7, 3, true);
    expect(p.kind).toBe('hip');
    expect(p.a).toEqual(p.b);
  });

  it('never leaves the walls too short, and gives up on a roof that would be too low', () => {
    // 3.6 m to the top: 2.3 m of wall leaves 1.3 m of roof at most.
    const low = roofPlan(rect(0, 0, 14, 8), 3.6, 0, true);
    expect(low.kind).not.toBe('flat');
    expect(low.rise).toBeCloseTo(3.6 - PITCHED.minWall, 6);
    expect(roofPlan(rect(0, 0, 14, 8), 3, 0, true).kind).toBe('flat');
  });

  it('leaves alone what the rule does not fit', () => {
    const ok = rect(0, 0, 14, 8);
    expect(roofPlan(ok, 7, 0, false).kind).toBe('flat'); // not a house
    expect(roofPlan(ok, PITCHED.maxHeight + 1, 0, true).kind).toBe('flat'); // too tall
    expect(roofPlan(rect(0, 0, 14, 3), 7, 0, true).kind).toBe('flat'); // too narrow
    expect(roofPlan(rect(0, 0, 60, 12), 7, 0, true).kind).toBe('flat'); // too long
    expect(roofPlan([0, 0, 5, 0, 0, -5], 7, 0, true).kind).toBe('flat'); // a triangle
    // An L: it fills too little of its bounding rectangle.
    expect(roofPlan([0, 0, 14, 0, 14, -4, 5, -4, 5, -12, 0, -12], 7, 0, true).kind).toBe('flat');
  });

  it('is the same roof every time, and different houses get different ones', () => {
    expect(roofPlan(rect(0, 0, 14, 8), 7, 41, true)).toEqual(roofPlan(rect(0, 0, 14, 8), 7, 41, true));
    const kinds = new Set<string>();
    const rises = new Set<number>();
    for (let s = 0; s < 64; s++) {
      const p = roofPlan(rect(0, 0, 14, 8), 9, s, true);
      kinds.add(p.kind);
      rises.add(Math.round(p.rise * 100));
    }
    expect(kinds).toEqual(new Set(['hip', 'gable']));
    expect(rises.size).toBeGreaterThan(20);
    expect(seeded(5, 1)).toBe(seeded(5, 1));
    expect(buildingSeed(12.25, -3.5)).toBe(buildingSeed(12.25, -3.5));
    expect(buildingSeed(12.25, -3.5)).toBeLessThan(256);
  });

  it('knows which styles are pitched: houses and small shops under iron or tile', () => {
    expect(pitchedStyle(makeStyle(6, 0))).toBe(true);
    expect(pitchedStyle(makeStyle(12, 4))).toBe(true);
    expect(pitchedStyle(makeStyle(3, 2))).toBe(true);
    expect(pitchedStyle(makeStyle(6, 5))).toBe(false); // a flat concrete roof
    expect(pitchedStyle(makeStyle(0, 0))).toBe(false); // a glass tower
    expect(pitchedStyle(makeStyle(13, 3))).toBe(false); // a shed
  });
});

interface Tri {
  /** Corner positions. */
  p: [number, number, number][];
  /** Normal, not normalised. */
  n: [number, number, number];
}
function triangles(chunk: { positions: Float32Array; indices: ArrayLike<number> }): Tri[] {
  const out: Tri[] = [];
  for (let t = 0; t < chunk.indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const v = chunk.indices[t + k] * 3;
      return [chunk.positions[v], chunk.positions[v + 1], chunk.positions[v + 2]] as [number, number, number];
    });
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    out.push({ p, n: [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]] });
  }
  return out;
}

describe('a house with a pitched roof', () => {
  for (const kind of ['hip', 'gable'] as const) {
    const seedWanted = seedFor(kind);
    // Find where to put the house so that its own seed (from its first corner) gives this kind.
    let x0 = 0;
    while (roofPlan(rect(x0, 0, 14, 8), 7, buildingSeed(x0, 0), true).kind !== kind) x0 += 0.25;
    void seedWanted;
    const house: BuildingRecord = { rings: [rect(x0, 0, 14, 8)], baseY: 20, topY: 27, style: HOUSE };
    const [chunk] = extrudeBuildings(build([house]), { bounds });
    const plan = roofPlan(rect(x0, 0, 14, 8), 7, buildingSeed(x0, 0), true);
    const eave = 27 - plan.rise;
    const tris = triangles(chunk);

    it(`${kind}: ten vertices, eight wall triangles and six of roof`, () => {
      expect(chunk.positions.length / 3).toBe(10);
      expect(tris).toHaveLength(8 + 6);
    });

    it(`${kind}: the ridge is at the height the map records, and the walls stop at the eaves`, () => {
      const ys = new Set<number>();
      for (let v = 0; v < chunk.positions.length / 3; v++) ys.add(Math.round(chunk.positions[v * 3 + 1] * 1000) / 1000);
      expect([...ys].sort((a, b) => a - b)).toEqual([20, Math.round(eave * 1000) / 1000, 27]);
      // Nothing is above the recorded top: collision needs no knowledge of the roof.
      for (let v = 0; v < chunk.positions.length / 3; v++) expect(chunk.positions[v * 3 + 1]).toBeLessThanOrEqual(27);
      // Every vertex says where the eaves are.
      for (let v = 0; v < chunk.positions.length / 3; v++) {
        expect(chunk.style[v * STYLE_SIZE + 1]).toBe(70);
        expect(chunk.style[v * STYLE_SIZE + 3]).toBe(Math.round((7 - plan.rise) * 10));
      }
    });

    it(`${kind}: every face of the roof faces the sky or stands upright, and the walls face out`, () => {
      const centre = [x0 + 7, -4];
      let sloped = 0;
      for (const t of tris) {
        const top = Math.max(...t.p.map((q) => q[1]));
        const bottom = Math.min(...t.p.map((q) => q[1]));
        const len = Math.hypot(...t.n);
        expect(len).toBeGreaterThan(1e-6);
        if (bottom >= eave - 1e-3) {
          // Roof: sloping faces up; a gable's end wall may be all but upright, leaning in.
          expect(t.n[1] / len).toBeGreaterThan(-1e-6);
          if (t.n[1] / len > 0.5) sloped++;
          expect(top).toBeCloseTo(27, 6);
        } else {
          // Wall: upright and facing away from the middle of the house.
          expect(Math.abs(t.n[1] / len)).toBeLessThan(1e-6);
          const c = [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3];
          expect(t.n[0] * (c[0] - centre[0]) + t.n[2] * (c[1] - centre[1])).toBeGreaterThan(0);
        }
      }
      // A hip has four sloping faces (six triangles); a gable two (four triangles) and two end walls.
      expect(sloped).toBe(kind === 'hip' ? 6 : 4);
    });

    it(`${kind}: the roof covers the footprint exactly`, () => {
      let area = 0;
      for (const t of tris) if (Math.min(...t.p.map((q) => q[1])) >= eave - 1e-3) area += Math.abs(t.n[1]) / 2;
      expect(area).toBeCloseTo(14 * 8, kind === 'hip' ? 6 : 0);
    });
  }

  it('keeps its flat roof on the low tier, and on anything that is not a house', () => {
    const house: BuildingRecord = { rings: [rect(0, 0, 14, 8)], baseY: 0, topY: 7, style: HOUSE };
    const [low] = extrudeBuildings(build([house]), { bounds, quality: 'low' });
    expect(low.positions.length / 3).toBe(8);
    expect(low.indices.length / 3).toBe(10);
    const office: BuildingRecord = { rings: [rect(0, 0, 14, 8)], baseY: 0, topY: 7, style: makeStyle(6, 5) };
    const [flat] = extrudeBuildings(build([office]), { bounds });
    expect(flat.positions.length / 3).toBe(8);
  });
});

describe('a plant room on a tower', () => {
  const ring = rect(0, 0, 30, 24);
  const tower: BuildingRecord = { rings: [ring], baseY: 10, topY: 70, style: TOWER };
  const room = plantRoom(ring, 60, buildingSeed(ring[0], ring[1]));

  it('is a box a few metres high, inside the roof and lined up with the building', () => {
    expect(room).not.toBeNull();
    expect(room!.height).toBeGreaterThanOrEqual(3.5);
    expect(room!.height).toBeLessThanOrEqual(6.2);
    for (const [x, z] of room!.corners) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(30);
      expect(z).toBeLessThan(0);
      expect(z).toBeGreaterThan(-24);
    }
    const [a, b, c] = room!.corners;
    // Right angles, sides along the building's own.
    expect((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])).toBeCloseTo(0, 6);
    expect(Math.min(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))).toBeCloseTo(0, 6);
  });

  it('is only for towers with room for one', () => {
    expect(plantRoom(ring, PLANT_ROOM.minHeight - 1, 0)).toBeNull();
    expect(plantRoom(rect(0, 0, 12, 12), 60, 0)).toBeNull(); // too small a roof
    expect(plantRoom(rect(0, 0, 60, 10), 60, 0)).toBeNull(); // too narrow
  });

  it('is drawn: eight more vertices in its own style, ten more triangles, all above the roof', () => {
    const [chunk] = extrudeBuildings(build([tower]), { bounds });
    expect(chunk.positions.length / 3).toBe(8 + 8);
    expect(chunk.indices.length / 3).toBe(10 + 10);
    let own = 0;
    for (let v = 0; v < chunk.positions.length / 3; v++) {
      if ((chunk.style[v * STYLE_SIZE] & 255) !== PLANT_ROOM_STYLE) continue;
      own++;
      expect(chunk.positions[v * 3 + 1]).toBeGreaterThanOrEqual(70);
      expect(chunk.positions[v * 3 + 1]).toBeLessThanOrEqual(70 + room!.height + 1e-4);
    }
    expect(own).toBe(8);
    // Its walls face out and its roof up.
    const cx = (room!.corners[0][0] + room!.corners[2][0]) / 2;
    const cz = (room!.corners[0][1] + room!.corners[2][1]) / 2;
    for (const t of triangles(chunk)) {
      if (Math.min(...t.p.map((q) => q[1])) < 70) continue;
      const len = Math.hypot(...t.n);
      const flat = Math.abs(t.n[1] / len) > 0.5;
      if (flat) expect(t.n[1]).toBeGreaterThan(0);
      else if (Math.max(...t.p.map((q) => q[1])) > 70 + 1e-3) {
        const c = [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3];
        expect(t.n[0] * (c[0] - cx) + t.n[2] * (c[1] - cz)).toBeGreaterThan(0);
      }
    }
    // The sphere the chunk is culled by reaches the top of it.
    expect(chunk.sphere.y + chunk.sphere.r).toBeGreaterThanOrEqual(70 + room!.height - 1e-3);
  });

  it('can be hit: the collision grid is as tall as what is drawn', () => {
    const heights = new Float32Array(21 * 21).fill(10);
    const terrain = { cols: 21, rows: 21, cell: 20, x0: -200, z0: -200, minH: 10, maxH: 10, heights };
    const grid = buildCollisionGrid(terrain, build([tower]), bounds, 6);
    let top = 0;
    for (const v of grid.data) top = Math.max(top, v / 10);
    expect(top).toBeCloseTo(70 + room!.height, 1);
  });
});

const realDir = new URL('../public/map/', import.meta.url);
describe.runIf(existsSync(new URL('buildings.bin.gz', realDir)))('roofs on the real map', () => {
  const meta = JSON.parse(readFileSync(new URL('meta.json', realDir), 'utf8')) as { bounds: typeof bounds; terrain: { file: string } };
  const b = decodeBuildings(new Uint8Array(gunzipSync(readFileSync(new URL('buildings.bin.gz', realDir)))));
  void decodeTerrain;

  it('gives about twelve thousand houses a roof and a hundred or so towers a plant room', () => {
    let pitched = 0;
    let gables = 0;
    let rooms = 0;
    for (let i = 0; i < b.count; i++) {
      const r0 = b.buildingRingStart[i];
      if (b.buildingRingStart[i + 1] - r0 !== 1) continue;
      const ring = b.xz.subarray(b.ringVertexStart[r0] * 2, b.ringVertexStart[r0 + 1] * 2);
      const h = b.topY[i] - b.baseY[i];
      const seed = buildingSeed(ring[0], ring[1]);
      const p = roofPlan(ring, h, seed, pitchedStyle(b.style[i]));
      if (p.kind !== 'flat') pitched++;
      if (p.kind === 'gable') gables++;
      if (plantRoom(ring, h, seed)) rooms++;
    }
    expect(pitched).toBeGreaterThan(10_000);
    expect(pitched).toBeLessThan(16_000);
    expect(gables).toBeGreaterThan(1_000);
    expect(rooms).toBeGreaterThan(60);
    expect(rooms).toBeLessThan(400);
  });

  it('adds no more than sixty thousand triangles to the whole city, and only the plant rooms to the low tier', () => {
    const count = (quality: 'high' | 'low') => extrudeBuildings(b, { bounds: meta.bounds, quality }).reduce((n, c) => n + c.indices.length / 3, 0);
    const high = count('high');
    // What the same buildings cost with flat roofs: walls two a corner, roof corners minus two (plus two a hole).
    let flat = 0;
    for (let i = 0; i < b.count; i++) {
      let v = 0;
      for (let r = b.buildingRingStart[i]; r < b.buildingRingStart[i + 1]; r++) v += b.ringVertexStart[r + 1] - b.ringVertexStart[r];
      flat += 2 * v + v - 2 + 2 * (b.buildingRingStart[i + 1] - b.buildingRingStart[i] - 1);
    }
    expect(high - flat).toBeGreaterThan(30_000);
    expect(high - flat).toBeLessThan(60_000);
    // The low tier has no pitched roofs (and drops its smallest buildings); plant rooms it must
    // have, because they can be hit.
    expect(count('low')).toBeLessThan(flat + 400 * 10);
    expect(count('low')).toBeLessThan(high - 30_000);
  });
});
