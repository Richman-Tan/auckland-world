import { describe, expect, it } from 'vitest';
import { type BuildingRecord, decodeBuildings, encodeBuildings } from '../src/shared/mapFormat';
import { extrudeBuildings, groupIntoChunks, skipBuilding } from '../src/world/extrude';

const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

/** Counter-clockwise on a north-up map = (x, -z) positive area: (0,0) -> (10,0) -> (10,-10) -> (0,-10). */
const squareCcw = (x0: number, z0: number, s: number) => [x0, z0, x0 + s, z0, x0 + s, z0 - s, x0, z0 - s];
const squareCw = (x0: number, z0: number, s: number) => [x0, z0, x0, z0 - s, x0 + s, z0 - s, x0 + s, z0];

function build(list: BuildingRecord[]) {
  return decodeBuildings(encodeBuildings(list));
}

type Tri = { n: [number, number, number]; c: [number, number, number]; ys: number[] };
function triangles(positions: Float32Array, indices: ArrayLike<number>): Tri[] {
  const out: Tri[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const p = [0, 1, 2].map((k) => {
      const v = indices[i + k] * 3;
      return [positions[v], positions[v + 1], positions[v + 2]] as [number, number, number];
    });
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    out.push({
      n: [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]],
      c: [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3],
      ys: p.map((q) => q[1]),
    });
  }
  return out;
}

describe('extrudeBuildings', () => {
  const box: BuildingRecord = { rings: [squareCcw(10, 10, 10)], baseY: 0, topY: 12, style: 0x21 };

  it('a box has 8 vertices and 10 triangles (8 wall, 2 roof)', () => {
    const [chunk] = extrudeBuildings(build([box]), { bounds });
    expect(chunk.positions.length / 3).toBe(8);
    expect(chunk.indices.length / 3).toBe(10);
    expect(chunk.indices).toBeInstanceOf(Uint16Array);
    expect(chunk.style.length).toBe(16);
    // style byte and rounded height are carried per vertex
    expect(chunk.style[0]).toBe(0x21);
    expect(chunk.style[1]).toBe(12);
  });

  it('a building with a hole shares top/bottom ring vertices: 16 vertices, 24 triangles', () => {
    const holed: BuildingRecord = {
      rings: [squareCcw(0, 0, 20), squareCw(5, -5, 10)],
      baseY: 0,
      topY: 10,
      style: 0,
    };
    const [chunk] = extrudeBuildings(build([holed]), { bounds });
    expect(chunk.positions.length / 3).toBe(16);
    // walls: 8 edges x 2 = 16; roof: a square ring with a square hole = 8 triangles
    expect(chunk.indices.length / 3).toBe(24);
  });

  it('roof triangles face up (+y)', () => {
    const holed: BuildingRecord = { rings: [squareCcw(0, 0, 20), squareCw(5, -5, 10)], baseY: 0, topY: 10, style: 0 };
    for (const rec of [box, holed]) {
      const [chunk] = extrudeBuildings(build([rec]), { bounds });
      const roofs = triangles(chunk.positions, chunk.indices).filter((t) => t.ys.every((y) => y === rec.topY));
      expect(roofs.length).toBeGreaterThan(0);
      for (const t of roofs) expect(t.n[1]).toBeGreaterThan(0);
    }
  });

  it('roofs face up even when the ring is stored clockwise', () => {
    const cw: BuildingRecord = { rings: [squareCw(10, 10, 10)], baseY: 0, topY: 9, style: 0 };
    const [chunk] = extrudeBuildings(build([cw]), { bounds });
    const roofs = triangles(chunk.positions, chunk.indices).filter((t) => t.ys.every((y) => y === 9));
    expect(roofs.length).toBe(2);
    for (const t of roofs) expect(t.n[1]).toBeGreaterThan(0);
  });

  it('walls face outward for counter-clockwise outer rings', () => {
    const [chunk] = extrudeBuildings(build([box]), { bounds });
    // building centre
    const cx = 15;
    const cz = 5;
    const walls = triangles(chunk.positions, chunk.indices).filter((t) => !t.ys.every((y) => y === 12));
    expect(walls.length).toBe(8);
    for (const t of walls) {
      expect(Math.abs(t.n[1])).toBeLessThan(1e-6); // vertical
      const out = t.n[0] * (t.c[0] - cx) + t.n[2] * (t.c[2] - cz);
      expect(out).toBeGreaterThan(0);
    }
  });

  it('hole walls face into the courtyard', () => {
    const holed: BuildingRecord = { rings: [squareCcw(0, 0, 20), squareCw(5, -5, 10)], baseY: 0, topY: 10, style: 0 };
    const [chunk] = extrudeBuildings(build([holed]), { bounds });
    const walls = triangles(chunk.positions, chunk.indices).filter((t) => !t.ys.every((y) => y === 10));
    const inner = walls.filter((t) => t.c[0] > 4 && t.c[0] < 16 && t.c[2] < -4 && t.c[2] > -16);
    expect(inner.length).toBe(8);
    for (const t of inner) {
      // courtyard centre (10, -10): the wall normal points towards it
      const toward = t.n[0] * (10 - t.c[0]) + t.n[2] * (-10 - t.c[2]);
      expect(toward).toBeGreaterThan(0);
    }
  });

  it('computes a bounding sphere that contains every vertex', () => {
    const [chunk] = extrudeBuildings(build([box]), { bounds });
    const s = chunk.sphere;
    for (let i = 0; i < chunk.positions.length; i += 3) {
      const d = Math.hypot(chunk.positions[i] - s.x, chunk.positions[i + 1] - s.y, chunk.positions[i + 2] - s.z);
      expect(d).toBeLessThanOrEqual(s.r + 1e-3);
    }
  });

  it('low quality drops small, low buildings only', () => {
    const small: BuildingRecord = { rings: [squareCcw(0, 0, 5)], baseY: 0, topY: 4, style: 0 }; // 25 m^2, 4 m
    const smallTall: BuildingRecord = { rings: [squareCcw(20, 0, 5)], baseY: 0, topY: 20, style: 0 };
    const bigLow: BuildingRecord = { rings: [squareCcw(40, 0, 10)], baseY: 0, topY: 4, style: 0 }; // 100 m^2
    const data = build([small, smallTall, bigLow]);
    expect([0, 1, 2].map((i) => skipBuilding(data, i, 'low'))).toEqual([true, false, false]);
    expect([0, 1, 2].map((i) => skipBuilding(data, i, 'high'))).toEqual([false, false, false]);
  });

  it('puts every building in exactly one chunk', () => {
    const list: BuildingRecord[] = [];
    for (let i = 0; i < 40; i++) {
      list.push({ rings: [squareCcw(-95 + (i % 8) * 24, -90 + Math.floor(i / 8) * 40, 6)], baseY: 0, topY: 8 + i, style: i & 255 });
    }
    const data = build(list);
    const groups = groupIntoChunks(data, bounds, 50);
    const seen = new Set<number>();
    let total = 0;
    for (const ids of groups.values()) {
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        total++;
      }
    }
    expect(total).toBe(40);
    expect(groups.size).toBeGreaterThan(1);
    const chunks = extrudeBuildings(data, { bounds, chunkSize: 50 });
    expect(chunks.reduce((n, c) => n + c.buildingCount, 0)).toBe(40);
  });
});
