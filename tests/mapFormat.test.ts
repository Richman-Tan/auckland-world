import { describe, expect, it } from 'vitest';
import {
  type BuildingRecord,
  decodeBuildings,
  decodeTerrain,
  encodeBuildings,
  encodeTerrain,
  isGzip,
  ringSignedAreaNorthUp,
  sampleTerrain,
} from '../src/shared/mapFormat';

describe('terrain format', () => {
  it('round-trips heights to 0.1 m', () => {
    const cols = 7;
    const rows = 5;
    const heights = new Float32Array(cols * rows);
    for (let i = 0; i < heights.length; i++) heights[i] = Math.sin(i) * 150 - 3;
    const enc = encodeTerrain({ cols, rows, cell: 20, x0: -60, z0: -40, minH: 0, maxH: 0, heights });
    const dec = decodeTerrain(enc);
    expect(dec.cols).toBe(cols);
    expect(dec.rows).toBe(rows);
    expect(dec.cell).toBe(20);
    expect(dec.x0).toBe(-60);
    expect(dec.z0).toBe(-40);
    for (let i = 0; i < heights.length; i++) expect(Math.abs(dec.heights[i] - heights[i])).toBeLessThanOrEqual(0.05 + 1e-6);
    expect(dec.minH).toBeCloseTo(Math.min(...heights), 4);
  });

  it('samples bilinearly and clamps outside', () => {
    const heights = new Float32Array([0, 10, 20, 30]);
    const t = { cols: 2, rows: 2, cell: 10, x0: 0, z0: 0, minH: 0, maxH: 30, heights };
    expect(sampleTerrain(t, 5, 0)).toBeCloseTo(5);
    expect(sampleTerrain(t, 5, 5)).toBeCloseTo(15);
    expect(sampleTerrain(t, -100, -100)).toBeCloseTo(0);
  });

  it('rejects bad magic', () => {
    expect(() => decodeTerrain(new Uint8Array(64))).toThrow(/magic/);
  });
});

describe('buildings format', () => {
  const list: BuildingRecord[] = [
    { rings: [[0, 0, 10, 0, 10, -10, 0, -10]], baseY: 2.3, topY: 30.1, style: 0x35 },
    {
      rings: [
        [100, 100, 140, 100, 140, 60, 100, 60],
        [110, 90, 110, 70, 130, 70, 130, 90],
      ],
      baseY: -1,
      topY: 180.4,
      style: 0xf0,
    },
  ];

  it('round-trips to 0.25 m / 0.1 m', () => {
    const dec = decodeBuildings(encodeBuildings(list));
    expect(dec.count).toBe(2);
    expect(dec.ringCount).toBe(3);
    expect(dec.vertexCount).toBe(12);
    expect(Array.from(dec.ringsPerBuilding)).toEqual([1, 2]);
    expect(Array.from(dec.buildingRingStart)).toEqual([0, 1, 3]);
    expect(Array.from(dec.ringVertexStart)).toEqual([0, 4, 8, 12]);
    expect(dec.baseY[0]).toBeCloseTo(2.3, 5);
    expect(dec.topY[1]).toBeCloseTo(180.4, 4);
    expect(dec.style[0]).toBe(0x35);
    const flat = list.flatMap((b) => b.rings.flat());
    flat.forEach((v, i) => expect(Math.abs(dec.xz[i] - v)).toBeLessThanOrEqual(0.125));
  });

  it('measures ring orientation on a north-up map', () => {
    // (0,0) -> (10,0) -> (10,-10) -> (0,-10): east, then north, then west: counter-clockwise.
    expect(ringSignedAreaNorthUp([0, 0, 10, 0, 10, -10, 0, -10])).toBeCloseTo(100);
    expect(ringSignedAreaNorthUp([0, 0, 0, -10, 10, -10, 10, 0])).toBeCloseTo(-100);
  });

  it('rejects degenerate rings', () => {
    expect(() => encodeBuildings([{ rings: [[0, 0, 1, 1]], baseY: 0, topY: 1, style: 0 }])).toThrow();
  });
});

describe('gzip sniff', () => {
  it('detects the gzip magic', () => {
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 8]))).toBe(true);
    expect(isGzip(new Uint8Array([0x41, 0x57]))).toBe(false);
  });
});
