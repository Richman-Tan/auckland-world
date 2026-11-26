import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HARBOUR_BRIDGE, bridgeModel, medianFilter, nonDecreasing } from '../src/shared/bridge';
import { landmarkColliders } from '../src/shared/collision';
import type { MapMeta } from '../src/shared/mapFormat';
import { TRUSS_PLANE, clipOnDepth } from '../src/world/landmarks/harbourBridge';
import { BRIDGE_CLIP_ON_CENTRE, BRIDGE_STRIP_LIFT, bridgeStrips, buildRibbons } from '../src/world/ribbons';

const load = (dir: string) => JSON.parse(readFileSync(new URL(`../public/${dir}/meta.json`, import.meta.url), 'utf8')) as MapMeta;
const realExists = existsSync(new URL('../public/map/meta.json', import.meta.url));
const maps: [string, MapMeta][] = [['fake', load('map-fake')], ...(realExists ? ([['real', load('map')]] as [string, MapMeta][]) : [])];

describe('smoothing helpers', () => {
  it('takes the middle value of each window, holding the ends', () => {
    expect(medianFilter([1, 9, 2, 3, 30, 4], 1)).toEqual([1, 2, 3, 3, 4, 4]);
    expect(medianFilter([5], 2)).toEqual([5]);
    expect(medianFilter([], 2)).toEqual([]);
  });

  it('finds the closest sequence that never goes down', () => {
    expect(nonDecreasing([1, 2, 3])).toEqual([1, 2, 3]);
    expect(nonDecreasing([1, 3, 2])).toEqual([1, 2.5, 2.5]);
    expect(nonDecreasing([3, 2, 1])).toEqual([2, 2, 2]);
    const out = nonDecreasing([10, 12, 11, 15, 14, 14, 20, 3]);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
    // It keeps the total: nothing is invented or lost.
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(10 + 12 + 11 + 15 + 14 + 14 + 20 + 3, 9);
  });
});

describe.each(maps)('the Harbour Bridge on the %s map', (name, meta) => {
  const hb = meta.landmarks.harbourBridge;
  const m = bridgeModel(hb);

  it('is the same object every time it is asked for', () => {
    expect(bridgeModel(hb)).toBe(m);
    expect(m.stations).toBe(hb.deckY.length);
  });

  it('has one truss, and the arch is in it', () => {
    expect(m.truss).not.toBeNull();
    const { first, last } = m.truss!;
    const archS = (hb.archTop.x - hb.a.x) * m.ux + (hb.archTop.z - hb.a.z) * m.uz;
    const arch = Math.round(archS / m.step);
    expect(first).toBeLessThanOrEqual(arch);
    expect(last).toBeGreaterThanOrEqual(arch);
    // A main span with its anchor arms, not a fragment (the made-up map's is longer than the real one).
    expect((last - first) * m.step).toBeGreaterThan(200);
    expect((last - first) * m.step).toBeLessThan(800);
    expect(first).toBeGreaterThanOrEqual(m.span.first);
    expect(last).toBeLessThanOrEqual(m.span.last);
    for (let i = 0; i < m.stations; i++) {
      const inside = i >= first && i <= last;
      expect(m.isTruss(i)).toBe(inside);
      if (inside) expect(m.topY[i] - m.deckY[i]).toBeGreaterThan(HARBOUR_BRIDGE.trussMinRise - 1);
      else expect(m.topY[i]).toBe(m.deckY[i]);
    }
    // The top of the truss is about where the map says the arch is.
    expect(Math.abs(Math.max(...m.topY) - hb.archTop.y)).toBeLessThan(3);
  });

  it('spans from abutment to abutment, and no further', () => {
    const { first, last } = m.span;
    expect(first).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThanOrEqual(m.stations - 1);
    expect((last - first) * m.step).toBeGreaterThan(900);
    expect(m.crest).toBeGreaterThan(first);
    expect(m.crest).toBeLessThan(last);
    // At each end the deck meets what was measured there: it neither hangs in the air nor digs in.
    const measured = medianFilter(hb.deckY, 1);
    expect(Math.abs(m.deckY[first] - measured[first])).toBeLessThan(2);
    expect(Math.abs(m.deckY[last] - measured[last])).toBeLessThan(2);
    // Nothing inside the span falls by an abutment's worth in one step.
    for (let i = first + 1; i <= last; i++) expect(Math.abs(m.deckY[i] - m.deckY[i - 1])).toBeLessThan(HARBOUR_BRIDGE.abutmentDrop);
  });

  it('has a deck that rises to one crest and falls from it', () => {
    for (let i = m.span.first + 1; i <= m.span.last; i++) {
      const d = m.deckY[i] - m.deckY[i - 1];
      if (i <= m.crest) expect(d, `rising at ${i}`).toBeGreaterThanOrEqual(-1e-9);
      else expect(d, `falling at ${i}`).toBeLessThanOrEqual(1e-9);
    }
    expect(m.deckY[m.crest]).toBe(Math.max(...m.deckY));
  });

  it('stays close to what was measured', () => {
    const measured = medianFilter(hb.deckY, 2);
    for (let i = m.span.first + 2; i <= m.span.last - 2; i++) expect(Math.abs(m.deckY[i] - measured[i]), `station ${i}`).toBeLessThan(3.2);
    expect(Math.abs(m.deckY[m.crest] - Math.max(...hb.deckY))).toBeLessThan(1.5);
  });

  it.runIf(name === 'real')('ends at the Northcote abutment, where the measured line runs on over the ground', () => {
    expect(m.span.first).toBe(0);
    expect(m.span.last).toBeLessThan(m.stations - 1);
    expect(m.span.last * m.step).toBeGreaterThan(1450);
    expect(m.truss).toEqual({ first: 63, last: 96 });
  });

  it('stands on piers: two for the navigation span, the rest evenly under the approaches', () => {
    const main = m.piers.filter((p) => p.main);
    expect(main).toHaveLength(2);
    // A navigation span of about the real one's 244 m, with the arch over the middle of it.
    expect(main[1].s - main[0].s).toBeGreaterThan(200);
    expect(main[1].s - main[0].s).toBeLessThanOrEqual(HARBOUR_BRIDGE.mainSpan + 1e-6);
    const truss = m.truss!;
    const middle = ((truss.first + truss.last) / 2) * m.step;
    expect(Math.abs((main[0].s + main[1].s) / 2 - middle)).toBeLessThan(1);
    // In order, inside the steel, and never closer together than a ship is wide.
    for (let i = 0; i < m.piers.length; i++) {
      expect(m.piers[i].s).toBeGreaterThan(m.steel.from);
      expect(m.piers[i].s).toBeLessThan(m.steel.to);
      if (i > 0) expect(m.piers[i].s - m.piers[i - 1].s).toBeGreaterThan(70);
    }
    expect(m.steel.from).toBeGreaterThanOrEqual(m.span.first * m.step);
    expect(m.steel.to).toBeLessThanOrEqual(m.span.last * m.step + 1e-6);
  });

  it('hangs its truss under the road: deepest at the main piers, almost nothing at the crown', () => {
    const [a, b] = m.piers.filter((p) => p.main).map((p) => p.s);
    const crown = (a + b) / 2;
    expect(m.depthAt(a)).toBeCloseTo(HARBOUR_BRIDGE.pierDepth, 6);
    expect(m.depthAt(b)).toBeCloseTo(HARBOUR_BRIDGE.pierDepth, 6);
    expect(m.depthAt(crown)).toBeCloseTo(HARBOUR_BRIDGE.crownDepth, 6);
    // Across the navigation span the truss only ever thins towards the crown and deepens from it.
    for (let s = a + 5; s <= b; s += 5) {
      const d = m.depthAt(s) - m.depthAt(s - 5);
      if (s <= crown) expect(d, `thinning at ${s}`).toBeLessThan(1e-6);
      else expect(d, `deepening at ${s}`).toBeGreaterThan(-1e-6);
    }
    // Outside the steel it is just the deck's own girders.
    if (m.steel.from > m.span.first * m.step) expect(m.depthAt(m.steel.from - 5)).toBe(HARBOUR_BRIDGE.deckThickness);
    // The underside is always below the road and never in the ground.
    for (let s = m.span.first * m.step; s <= m.span.last * m.step; s += 7) {
      expect(m.bottomAt(s)).toBeLessThanOrEqual(m.deckAt(s) - 1 + 1e-9);
      expect(m.bottomAt(s)).toBeGreaterThanOrEqual(Math.min(m.groundAt(s) + 0.5, m.deckAt(s) - 1) - 1e-9);
      expect(m.depthAt(s)).toBeLessThanOrEqual(HARBOUR_BRIDGE.pierDepth + 1e-9);
    }
  });

  it('holds the viaducts up on rows of columns, where there is room for them', () => {
    for (const s of m.bents) {
      expect(s < m.steel.from + 1e-6 || s > m.steel.to - 1e-6, `row at ${s}`).toBe(true);
      expect(m.deckAt(s) - m.groundAt(s)).toBeGreaterThanOrEqual(HARBOUR_BRIDGE.bentMinClearance);
    }
    for (let i = 1; i < m.bents.length; i++) expect(m.bents[i] - m.bents[i - 1]).toBeGreaterThanOrEqual(HARBOUR_BRIDGE.bentSpacing - 1e-6);
  });

  it('can be hit wherever it is drawn: the colliders reach the underside, and the piers their caps', () => {
    const colliders = landmarkColliders(meta);
    const box = (c: (typeof colliders)[number]) => {
      if (c.kind !== 'box') throw new Error('expected a box');
      return c;
    };
    const along = (c: { cx: number; cz: number }) => (c.cx - hb.a.x) * m.ux + (c.cz - hb.a.z) * m.uz;
    for (const c of colliders.filter((k) => k.name === 'Harbour Bridge deck').map(box)) {
      const s = along(c);
      expect(c.y0).toBeLessThanOrEqual(m.bottomAt(s) + 1e-6);
      // The parapet and the clip-on girders are inside it.
      expect(c.y1).toBeGreaterThanOrEqual(m.deckAt(s) + 1.1);
      expect(c.hv).toBeGreaterThanOrEqual(18.7);
      // (The clip-ons belong to the steel bridge; the viaducts have none.)
      if (s > m.steel.from + 5 && s < m.steel.to - 5) expect(m.deckAt(s) - clipOnDepth(m, s)).toBeGreaterThanOrEqual(c.y0 - 0.6);
    }
    for (const c of colliders.filter((k) => k.name === 'Harbour Bridge pier').map(box)) {
      const s = along(c);
      expect(c.y0).toBeLessThan(0);
      expect(c.y1).toBeCloseTo(m.bottomAt(s) - HARBOUR_BRIDGE.pierCapHeight, 6);
      // Both legs: they stand under the two planes of the truss.
      expect(c.hv).toBeGreaterThanOrEqual(TRUSS_PLANE + 3.5 - 1e-9);
    }
    for (const c of colliders.filter((k) => k.name === 'Harbour Bridge pier cap').map(box)) {
      expect(c.hv).toBeGreaterThanOrEqual(19.5);
      expect(c.y1).toBeGreaterThan(c.y0);
    }
  });

  it.runIf(name === 'real')('is the real bridge: 1,020 m of steel on six piers, 43 m clear at the crown, viaducts beyond', () => {
    // Shore to shore. The real bridge is 1,020 m long.
    expect(m.steel.to - m.steel.from).toBeGreaterThan(960);
    expect(m.steel.to - m.steel.from).toBeLessThan(1080);
    expect(m.piers).toHaveLength(6);
    expect(m.piers.map((p) => p.main)).toEqual([false, false, false, false, true, true]);
    // Every pier stands in the water.
    for (const p of m.piers) expect(m.groundAt(p.s), `pier at ${p.s}`).toBeLessThan(0.5);
    // Shipping gets 43 m under the middle of the navigation span.
    const [a, b] = m.piers.filter((p) => p.main).map((p) => p.s);
    expect(m.bottomAt((a + b) / 2)).toBeGreaterThan(41);
    expect(m.bottomAt((a + b) / 2)).toBeLessThan(45);
    // Columns at both ends: the short southern approach and the long viaduct north of Stokes Point.
    expect(m.bents.filter((s) => s <= m.steel.from).length).toBeGreaterThanOrEqual(1);
    expect(m.bents.filter((s) => s >= m.steel.to).length).toBeGreaterThanOrEqual(6);
    // The ground was measured: land at both ends, sea under the crest.
    expect(hb.groundY).toHaveLength(hb.deckY.length);
    expect(m.groundAt(0)).toBeGreaterThan(3);
    expect(m.groundAt(m.crest * m.step)).toBe(0);
  });

  it('paints eight lanes on the deck, lying just above the road for its whole length', () => {
    const strips = bridgeStrips(hb);
    expect(strips).toHaveLength(3);
    expect(strips.reduce((n, s) => n + s.lanes, 0)).toBe(8);
    expect(strips.filter((s) => s.oneway)).toHaveLength(2);
    for (const strip of strips) {
      expect(strip.stations).toHaveLength(m.span.last - m.span.first + 1);
      for (const st of strip.stations) {
        const s = st.along + m.span.first * m.step;
        expect(st.y - m.deckAt(s)).toBeCloseTo(BRIDGE_STRIP_LIFT, 6);
        expect(Math.hypot(st.nx, st.nz)).toBeCloseTo(1, 9);
      }
      for (let i = 1; i < strip.stations.length; i++) expect(strip.stations[i].along).toBeGreaterThan(strip.stations[i - 1].along);
    }
    // Built into the road mesh: every triangle faces up, and the strips do not overlap or reach the truss.
    const none = { count: 0, vertexCount: 0, cls: new Uint8Array(0), flags: new Uint8Array(0), wayStart: new Uint32Array(1), xz: new Float32Array(0) };
    const mesh = buildRibbons(none, () => 0, meta.bounds, { strips });
    expect(mesh.indices.length).toBe(3 * 2 * 3 * (m.span.last - m.span.first));
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map((v) => [mesh.positions[v * 3], mesh.positions[v * 3 + 2]]);
      // Seen from above (x east, z south) a triangle that faces up is wound clockwise.
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeLessThan(0);
    }
    const [centre, left, right] = strips;
    expect(centre.half).toBeLessThanOrEqual(TRUSS_PLANE - 1.3 + 1e-9);
    expect(BRIDGE_CLIP_ON_CENTRE - left.half).toBeGreaterThanOrEqual(TRUSS_PLANE + 1.3 - 1e-9);
    expect(BRIDGE_CLIP_ON_CENTRE + right.half).toBeLessThanOrEqual(18);
  });

  it('interpolates between stations and places points across the deck', () => {
    expect(m.deckAt(0)).toBe(m.deckY[0]);
    expect(m.deckAt(m.step * 2.5)).toBeCloseTo((m.deckY[2] + m.deckY[3]) / 2, 9);
    const centre = m.at(100, 0);
    const side = m.at(100, 7);
    expect(Math.hypot(side.x - centre.x, side.z - centre.z)).toBeCloseTo(7, 9);
    expect(centre.y).toBeCloseTo(m.deckAt(100), 9);
    expect(m.at(100, 0, 99).y).toBe(99);
    expect(Math.hypot(m.ux, m.uz)).toBeCloseTo(1, 9);
  });

  it('puts truss colliders on the truss and nowhere else', () => {
    const colliders = landmarkColliders(meta);
    const truss = colliders.filter((c) => c.name === 'Harbour Bridge truss');
    const deck = colliders.filter((c) => c.name === 'Harbour Bridge deck');
    const { first, last } = m.truss!;
    expect(truss).toHaveLength(last - first);
    expect(deck).toHaveLength(m.span.last - m.span.first);
    for (const c of truss) {
      if (c.kind !== 'box') throw new Error('expected a box');
      const s = (c.cx - hb.a.x) * m.ux + (c.cz - hb.a.z) * m.uz;
      expect(s).toBeGreaterThan(first * m.step);
      expect(s).toBeLessThan(last * m.step);
      expect(c.y1).toBeGreaterThan(c.y0);
    }
    expect(colliders.filter((c) => c.name === 'Harbour Bridge pier')).toHaveLength(m.piers.length);
    expect(colliders.filter((c) => c.name === 'Harbour Bridge pier cap')).toHaveLength(m.piers.length);
    expect(colliders.filter((c) => c.name === 'Harbour Bridge columns')).toHaveLength(m.bents.length);
  });
});
