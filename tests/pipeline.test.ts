import { describe, expect, it } from 'vitest';
import { decodeBuildings, encodeBuildings, ringSignedAreaNorthUp } from '../src/shared/mapFormat';
import { signedArea } from '../scripts/lib/geom';
import { parseMultihashSha256 } from '../scripts/lib/multihash';
import { mergeElements, worldBBox } from '../scripts/fetch/overpass';
import { lonLatToLocal } from '../scripts/lib/geo';
import { polygonsOf, type OsmElement } from '../scripts/lib/osm';
import { BOUNDS } from '../scripts/config';

describe('multihash parsing', () => {
  const digest = '06b2c8bd1cf34188e2a20886dfb1069083a31198d4ec7d2f8482cf1e94090b92';
  it('strips the 1220 prefix', () => {
    expect(parseMultihashSha256('1220' + digest)).toBe(digest);
  });
  it('lowercases hex', () => {
    expect(parseMultihashSha256('1220' + digest.toUpperCase())).toBe(digest);
  });
  it('rejects other hashes and bad lengths', () => {
    expect(() => parseMultihashSha256('1320' + digest)).toThrow();
    expect(() => parseMultihashSha256('1220abcd')).toThrow();
    expect(() => parseMultihashSha256('xyz')).toThrow();
  });
});

describe('Overpass helpers', () => {
  it('de-duplicates merged split responses by type and id', () => {
    const merged = mergeElements([
      { elements: [{ type: 'way', id: 1 }, { type: 'way', id: 2 }] },
      { elements: [{ type: 'way', id: 2 }, { type: 'node', id: 2 }] },
    ]);
    expect(merged).toHaveLength(3);
  });
  it('bbox is the world plus the margin, in lat/lon', () => {
    const b = worldBBox(500);
    expect(b.s).toBeCloseTo(-36.89, 2);
    expect(b.n).toBeCloseTo(-36.808, 2);
    expect(b.w).toBeCloseTo(174.716, 2);
    expect(b.e).toBeCloseTo(174.81, 2);
    expect(worldBBox(2000).s).toBeLessThan(b.s);
  });
});

describe('multipolygon assembly from OSM members', () => {
  const pt = (lat: number, lon: number) => ({ lat, lon });
  const base = { lat: -36.85, lon: 174.76 };
  const d = 0.0004;
  const ring = (cx: number, cy: number, r: number) => [
    pt(cx - r, cy - r), pt(cx - r, cy + r), pt(cx + r, cy + r), pt(cx + r, cy - r), pt(cx - r, cy - r),
  ];
  it('builds an outer ring from two ways and attaches an inner ring as a hole', () => {
    const o = ring(base.lat, base.lon, d);
    const el: OsmElement = {
      type: 'relation',
      id: 1,
      tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: o.slice(0, 3) },
        { type: 'way', ref: 2, role: 'outer', geometry: o.slice(2) },
        { type: 'way', ref: 3, role: 'inner', geometry: ring(base.lat, base.lon, d / 4) },
      ],
    };
    const polys = polygonsOf(el);
    expect(polys).toHaveLength(1);
    expect(polys[0].rings).toHaveLength(2);
    // Outer is about 2d x 2d degrees: tens of metres.
    expect(Math.abs(signedArea(polys[0].rings[0]))).toBeGreaterThan(1000);
    expect(Math.abs(signedArea(polys[0].rings[1]))).toBeLessThan(Math.abs(signedArea(polys[0].rings[0])) / 10);
  });
  it('turns a closed way into one outer ring and ignores open ways', () => {
    const closed: OsmElement = { type: 'way', id: 2, geometry: ring(base.lat, base.lon, d) };
    const open: OsmElement = { type: 'way', id: 3, geometry: ring(base.lat, base.lon, d).slice(0, 3) };
    expect(polygonsOf(closed)).toHaveLength(1);
    expect(polygonsOf(open)).toHaveLength(0);
  });
  it('projects into the local frame (north is -z)', () => {
    const north = lonLatToLocal(174.76, -36.84);
    const south = lonLatToLocal(174.76, -36.86);
    expect(north.z).toBeLessThan(south.z);
    expect(north.z).toBeGreaterThanOrEqual(BOUNDS.minZ);
  });
});

describe('buildings format round trip with pipeline conventions', () => {
  it('keeps a CCW (north-up) outer ring and a CW hole after encode/decode', () => {
    // North-up CCW: east, then north (-z), then west.
    const outer = [0, 0, 20, 0, 20, -20, 0, -20];
    const hole = [5, -5, 5, -15, 15, -15, 15, -5];
    expect(ringSignedAreaNorthUp(outer)).toBeGreaterThan(0);
    expect(ringSignedAreaNorthUp(hole)).toBeLessThan(0);
    const bytes = encodeBuildings([{ rings: [outer, hole], baseY: 1, topY: 9, style: 0x3a }]);
    const b = decodeBuildings(bytes);
    expect(b.count).toBe(1);
    expect(b.ringCount).toBe(2);
    expect(ringSignedAreaNorthUp(b.xz.subarray(0, 8))).toBeCloseTo(400);
    expect(b.topY[0]).toBeCloseTo(9);
  });
});
