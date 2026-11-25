import { describe, expect, it } from 'vitest';
import { ROOF_PALETTE, WALL_PALETTE, roofIndex, wallIndex } from '../src/shared/palette';
import { LOW_ROOF_BELOW, ROOF_RANGE, WALL_RANGE, nearestIndex, parseColour, pickStyle, wallClass } from '../scripts/lib/style';

const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;

describe('building styles', () => {
  it('gives every low building an iron or tile roof and every taller one flat concrete', () => {
    const lowRoofs = new Map<number, number>();
    const flatRoofs = new Map<number, number>();
    for (let id = 1; id <= 40_000; id += 7) {
      for (const type of ['house', 'yes', 'residential', 'retail', 'warehouse']) {
        const low = roofIndex(pickStyle(id * 2654435761, type, 6));
        const tall = roofIndex(pickStyle(id * 2654435761, type, 18));
        expect(within(low, ROOF_RANGE.low), `low roof ${low}`).toBe(true);
        expect(within(tall, ROOF_RANGE.flat), `flat roof ${tall}`).toBe(true);
        lowRoofs.set(low, (lowRoofs.get(low) ?? 0) + 1);
        flatRoofs.set(tall, (flatRoofs.get(tall) ?? 0) + 1);
      }
    }
    // Every intended colour is used, and none of the iron colours dominates.
    expect([...lowRoofs.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...flatRoofs.keys()].sort()).toEqual([5, 6, 7]);
    const total = [...lowRoofs.values()].reduce((a, b) => a + b, 0);
    for (const i of [0, 1, 2, 3]) {
      expect(lowRoofs.get(i)! / total).toBeGreaterThan(0.15);
      expect(lowRoofs.get(i)! / total).toBeLessThan(0.27);
    }
    expect(lowRoofs.get(4)! / total).toBeGreaterThan(0.1);
    expect(lowRoofs.get(4)! / total).toBeLessThan(0.23);
  });

  it('keeps a building\'s kind readable from its wall', () => {
    for (let id = 3; id < 30_000; id += 11) {
      const big = id * 40503 + 0x80000000; // exercises the top bit, where the old shift went negative
      expect(within(wallIndex(pickStyle(big, 'house', 6)), WALL_RANGE.house)).toBe(true);
      expect(within(wallIndex(pickStyle(big, 'yes', 6)), WALL_RANGE.house)).toBe(true);
      expect(within(wallIndex(pickStyle(big, 'retail', 9)), WALL_RANGE.commercial)).toBe(true);
      expect(within(wallIndex(pickStyle(big, 'yes', 14)), WALL_RANGE.commercial)).toBe(true);
      expect(wallIndex(pickStyle(big, 'warehouse', 8))).toBe(13);
      expect(within(wallIndex(pickStyle(big, 'office', 60)), WALL_RANGE.glass)).toBe(true);
    }
    expect(wallClass('house', 50)).toBe('glass');
    expect(wallClass('shed', 4)).toBe('industrial');
    expect(wallClass('apartments', 15)).toBe('commercial');
    expect(wallClass('yes', 11.9)).toBe('house');
  });

  it('is the same every time for the same building', () => {
    expect(pickStyle(123456789, 'house', 6)).toBe(pickStyle(123456789, 'house', 6));
    expect(LOW_ROOF_BELOW).toBe(10);
  });

  it('reads the colours mappers record', () => {
    expect(parseColour('#a2a0a0')).toEqual([162, 160, 160]);
    expect(parseColour('#ABC')).toEqual([170, 187, 204]);
    expect(parseColour(' Light_Grey ')).toEqual([211, 211, 211]);
    expect(parseColour('red')).toEqual([178, 34, 34]);
    expect(parseColour('rainbow')).toBeNull();
    expect(parseColour('')).toBeNull();
    expect(parseColour(undefined)).toBeNull();
    expect(parseColour('#12345')).toBeNull();
  });

  it('uses a recorded colour, within what suits the building', () => {
    // A red iron roof on a house; the same tag on a tower picks from the flat roofs.
    expect(roofIndex(pickStyle(1, 'house', 6, { 'roof:colour': 'red' }))).toBe(0);
    expect(roofIndex(pickStyle(1, 'house', 6, { 'roof:colour': '#4f6f4a' }))).toBe(1);
    expect(roofIndex(pickStyle(1, 'house', 6, { 'roof:colour': '#a2a0a0' }))).toBe(3);
    expect(within(roofIndex(pickStyle(1, 'office', 30, { 'roof:colour': 'red' })), ROOF_RANGE.flatTagged)).toBe(true);
    expect(roofIndex(pickStyle(1, 'office', 30, { 'roof:colour': '#43b3ae' }))).toBe(10);
    // Walls: brick red on a house is brick; on a shop it is still a commercial wall.
    expect(wallIndex(pickStyle(1, 'house', 6, { 'building:colour': '#a8644e' }))).toBe(11);
    expect(wallIndex(pickStyle(1, 'house', 6, { 'building:colour': 'white' }))).toBe(6);
    expect(within(wallIndex(pickStyle(1, 'retail', 8, { 'building:colour': '#a8644e' })), WALL_RANGE.commercial)).toBe(true);
    // Nonsense is ignored.
    expect(pickStyle(77, 'house', 6, { 'roof:colour': 'rainbow', 'building:colour': 'nope' })).toBe(pickStyle(77, 'house', 6));
  });

  it('finds the nearest palette entry inside a range', () => {
    expect(nearestIndex([178, 58, 58], ROOF_PALETTE, [0, 15])).toBe(0);
    expect(nearestIndex([255, 255, 255], WALL_PALETTE, [6, 12])).toBe(6);
    expect(nearestIndex([0, 0, 0], ROOF_PALETTE, [5, 7])).toBe(7);
  });
});
