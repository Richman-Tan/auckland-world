import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HARBOUR_BRIDGE, bridgeModel, medianFilter, nonDecreasing } from '../src/shared/bridge';
import { landmarkColliders } from '../src/shared/collision';
import type { MapMeta } from '../src/shared/mapFormat';

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
    expect(colliders.filter((c) => c.name === 'Harbour Bridge pier')).toHaveLength(HARBOUR_BRIDGE.pierFractions.length);
  });
});
