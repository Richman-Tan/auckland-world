import { describe, expect, it } from 'vitest';
import type { StopPlacement, WorldQuery } from '../src/app/contracts';
import { holdShot } from '../src/flight/holdView';
import { drawGlyph } from '../src/render/icons';
import { pixelScaleFor } from '../src/shared/pixelScale';

describe('beacon icons', () => {
  for (const name of ['code', 'briefcase', 'cap', 'chat', 'peak'] as const) {
    it(`${name} leaves room for its outline on every side`, () => {
      const m = drawGlyph(name);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (m[y * 16 + x] !== 0) {
            expect(x, `${name} at ${x},${y}`).toBeGreaterThanOrEqual(1);
            expect(x, `${name} at ${x},${y}`).toBeLessThanOrEqual(14);
            expect(y, `${name} at ${x},${y}`).toBeGreaterThanOrEqual(1);
            expect(y, `${name} at ${x},${y}`).toBeLessThanOrEqual(14);
          }
        }
      }
    });
  }
});

describe('holding camera shot', () => {
  const flat = { solidAt: () => 0 } as unknown as WorldQuery;
  const tower = { id: 'projects', x: 100, z: -50, groundY: 40, baseY: 372, orbitY: 432, orbitRadius: 240 } as StopPlacement;
  it('stands well outside the orbit, above it, looking at the landmark body', () => {
    const s = holdShot(tower, 0, flat);
    expect(Math.hypot(s.x - tower.x, s.z - tower.z)).toBeCloseTo(240 * 2.3);
    expect(s.y).toBeGreaterThan(tower.orbitY);
    expect([s.lookX, s.lookZ]).toEqual([tower.x, tower.z]);
    expect(s.lookY).toBeGreaterThan(tower.groundY);
    expect(s.lookY).toBeLessThan(tower.baseY);
  });
  it('climbs above high ground', () => {
    const hill = { solidAt: () => 900 } as unknown as WorldQuery;
    expect(holdShot(tower, 1, hill).y).toBeGreaterThanOrEqual(940);
  });
});

describe('pixel scale', () => {
  it('is set from the window height alone, before any renderer exists', () => {
    expect(pixelScaleFor(742)).toBe(2);
    expect(pixelScaleFor(1080)).toBe(3);
    expect(pixelScaleFor(400)).toBe(2);
    expect(pixelScaleFor(1440)).toBe(4);
  });
});
