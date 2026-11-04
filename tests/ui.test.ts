import { describe, expect, it } from 'vitest';
import { cardinal, angleDelta, edgeArrow, formatDistance, formatEta, hudLine, loadingFraction, loadingText, pad3 } from '../src/ui/format';
import { mapToWorld, radarPoint, worldToMap } from '../src/ui/minimap';

describe('format', () => {
  it('pads headings', () => {
    expect(pad3(45)).toBe('045');
    expect(pad3(359.6)).toBe('000');
    expect(pad3(-10)).toBe('350');
  });
  it('formats distance and eta', () => {
    expect(formatDistance(1234)).toBe('1.2 KM');
    expect(formatDistance(480)).toBe('480 M');
    expect(formatEta(65)).toBe('1:05');
  });
  it('builds the HUD line', () => {
    expect(hudLine({ place: 'Ponsonby', headingDeg: 45, target: { label: 'SKY TOWER', distanceM: 1200 } })).toBe('OVER PONSONBY · HDG 045 · SKY TOWER 1.2 KM');
    expect(hudLine({ place: null, headingDeg: 0, target: null })).toBe('OVER AUCKLAND · HDG 000');
    expect(hudLine({ place: 'x', headingDeg: 0, target: null, pullUp: true })).toContain('PULL UP');
  });
  it('loading text', () => {
    expect(loadingText(1_500_000, 3_000_000)).toBe('1.5 / 3.0 MB');
    expect(loadingFraction(1, 0)).toBeNull();
    expect(loadingFraction(5, 10)).toBe(0.5);
  });
  it('angles', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(cardinal(90)).toBe('E');
    expect(cardinal(10)).toBeNull();
  });
  it('places the off-screen arrow', () => {
    expect(edgeArrow(0, 1000, 800).y).toBeLessThan(400);
    expect(edgeArrow(90, 1000, 800).x).toBeGreaterThan(500);
    expect(edgeArrow(-90, 1000, 800).x).toBeLessThan(500);
  });
});

describe('minimap geometry', () => {
  const b = { minX: -100, maxX: 100, minZ: -200, maxZ: 200 };
  it('maps bounds exactly, north up', () => {
    expect(worldToMap(b, 200, 400, -100, -200)).toEqual({ x: 0, y: 0 });
    expect(worldToMap(b, 200, 400, 100, 200)).toEqual({ x: 200, y: 400 });
    const back = mapToWorld(b, 200, 400, 50, 100);
    expect(worldToMap(b, 200, 400, back.x, back.z)).toEqual({ x: 50, y: 100 });
  });
  it('radar is heading-up', () => {
    // heading north (0): a point to the north (-z) is up (negative y)
    const n = radarPoint({ x: 0, z: 0, headingRad: 0 }, 0, -500, 1000, 48);
    expect(n.y).toBeLessThan(0);
    expect(Math.abs(n.x)).toBeLessThan(1e-9);
    // heading east: a point to the east is up
    const e = radarPoint({ x: 0, z: 0, headingRad: Math.PI / 2 }, 500, 0, 1000, 48);
    expect(e.y).toBeLessThan(0);
    expect(Math.abs(e.x)).toBeLessThan(1e-9);
    // out of range is clamped
    expect(radarPoint({ x: 0, z: 0, headingRad: 0 }, 0, -9000, 1000, 48).clamped).toBe(true);
  });
});
