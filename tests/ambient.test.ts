import { describe, expect, it } from 'vitest';
import {
  BRIDGE_LANES,
  BRIDGE_LANES_FIT,
  FERRY_DWELL_S,
  FERRY_ROUTES,
  bridgeCar,
  bridgeCruisePath,
  bridgeGeometry,
  ferryPaths,
  makePath,
  pathAt,
  pathOverWater,
  routePath,
  shuttleAt,
} from '../src/shared/ambientPaths';
import { HARBOUR_BRIDGE } from '../src/shared/collision';
import { FAKE_DIR, REAL_DIR, loadWorld, realMapExists } from './flightWorld';

describe('ambient paths', () => {
  const square = makePath([
    { x: 0, z: 0 },
    { x: 0, z: -100 },
    { x: 100, z: -100 },
  ]);

  it('walks a polyline by distance, with the heading of the leg it is on', () => {
    expect(square.length).toBe(200);
    expect(pathAt(square, 0)).toMatchObject({ x: 0, z: 0 });
    expect(pathAt(square, 50).z).toBeCloseTo(-50, 6);
    expect(pathAt(square, 50).heading).toBeCloseTo(0, 6); // north
    expect(pathAt(square, 150).x).toBeCloseTo(50, 6);
    expect(pathAt(square, 150).heading).toBeCloseTo(Math.PI / 2, 6); // east
    // Clamped at both ends.
    expect(pathAt(square, -20)).toMatchObject({ x: 0, z: 0 });
    expect(pathAt(square, 999).x).toBeCloseTo(100, 6);
  });

  it('a boat shuttles out, waits at the wharf, comes back facing the other way, and waits again', () => {
    const speed = 10;
    const leg = square.length / speed;
    const out = shuttleAt(square, speed, 5);
    expect(out.z).toBeCloseTo(-50, 6);
    expect(out.heading).toBeCloseTo(0, 6);
    const waiting = shuttleAt(square, speed, leg + FERRY_DWELL_S / 2);
    expect(waiting.x).toBeCloseTo(100, 6);
    const back = shuttleAt(square, speed, leg + FERRY_DWELL_S + 5);
    expect(back.x).toBeCloseTo(50, 6);
    expect(back.heading).toBeCloseTo(Math.PI / 2 + Math.PI, 6); // west
    const home = shuttleAt(square, speed, 2 * leg + FERRY_DWELL_S + 1);
    expect(home).toMatchObject({ x: 0, z: 0 });
    // The cycle repeats, and a phase of half puts a second boat at the far end as the first sets off.
    const cycle = 2 * (leg + FERRY_DWELL_S);
    expect(shuttleAt(square, speed, 5 + cycle).z).toBeCloseTo(-50, 6);
    expect(shuttleAt(square, speed, 0, 0.5).x).toBeCloseTo(100, 6);
    // It never leaves the path, whatever the time.
    for (let t = -500; t < 500; t += 7.3) {
      const p = shuttleAt(square, speed, t);
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(100 + 1e-6);
      expect(p.z).toBeGreaterThanOrEqual(-100 - 1e-6);
      expect(p.z).toBeLessThanOrEqual(1e-6);
    }
  });

  it('bridge traffic keeps left, stays on the deck and inside the truss', () => {
    expect(BRIDGE_LANES_FIT).toBe(true);
    const length = 1600;
    for (let t = 0; t < 400; t += 3.7) {
      for (let i = 0; i < 36; i++) {
        const car = bridgeCar(i, 36, length, t);
        expect(car.s).toBeGreaterThanOrEqual(0);
        expect(car.s).toBeLessThanOrEqual(length);
        expect(Math.abs(car.lateral)).toBeLessThan(HARBOUR_BRIDGE.trussHalfWidth - 1.5);
        expect(BRIDGE_LANES as readonly number[]).toContain(Math.abs(car.lateral));
        // Driving a to b you are on the -lateral side; coming back, on the other.
        expect(Math.sign(car.lateral)).toBe(car.forward ? -1 : 1);
      }
    }
    // Both directions are in use, and a car moves the way it faces.
    const a0 = bridgeCar(0, 36, length, 10);
    const a1 = bridgeCar(0, 36, length, 11);
    const b0 = bridgeCar(1, 36, length, 10);
    const b1 = bridgeCar(1, 36, length, 11);
    expect(a0.forward).toBe(true);
    expect(b0.forward).toBe(false);
    expect((a1.s - a0.s + length) % length).toBeGreaterThan(15);
    expect((b0.s - b1.s + length) % length).toBeGreaterThan(15);
  });

  it('on the synthetic map, boats only ever use water', () => {
    const { meta, world } = loadWorld(FAKE_DIR);
    for (const { path } of ferryPaths(meta, world)) expect(pathOverWater(path, world, meta)).toBe(true);
    // A path across the middle of the city is refused.
    const t = meta.landmarks.skyTower;
    const inland = makePath([
      { x: t.x - 200, z: t.z },
      { x: t.x + 200, z: t.z },
    ]);
    expect(pathOverWater(inland, world, meta)).toBe(false);
    // So is one that leaves the map.
    const off = makePath([
      { x: meta.bounds.maxX - 50, z: 0 },
      { x: meta.bounds.maxX + 400, z: 0 },
    ]);
    expect(pathOverWater(off, world, meta)).toBe(false);
  });
});

describe.skipIf(!realMapExists)('ambient paths on the real map', () => {
  const { meta, world } = loadWorld(REAL_DIR);

  it('every ferry route is over open water for its whole length, with room either side', () => {
    for (const route of FERRY_ROUTES) {
      const path = routePath(meta.geo, route);
      expect(path.length, route.name).toBeGreaterThan(800);
      expect(pathOverWater(path, world, meta), route.name).toBe(true);
    }
    expect(ferryPaths(meta, world).length).toBe(FERRY_ROUTES.length + 1);
  });

  it('the bridge cruise passes under the main span, clear of both piers', () => {
    const hb = meta.landmarks.harbourBridge;
    const cruise = bridgeCruisePath(hb);
    expect(pathOverWater(cruise, world, meta)).toBe(true);
    const g = bridgeGeometry(hb);
    const [, , , , pierA, pierB] = HARBOUR_BRIDGE.pierFractions;
    // Where the cruise crosses the bridge's centreline, as a fraction of the way along it.
    const mid = pathAt(cruise, cruise.length / 2);
    const along = ((mid.x - hb.a.x) * (hb.b.x - hb.a.x) + (mid.z - hb.a.z) * (hb.b.z - hb.a.z)) / (g.length * g.length);
    expect(along).toBeGreaterThan(pierA);
    expect(along).toBeLessThan(pierB);
    const clearM = Math.min(along - pierA, pierB - along) * g.length;
    expect(clearM).toBeGreaterThan(60);
    // And the deck is high enough above a ferry there.
    expect(g.at(along * g.length, 0).y - HARBOUR_BRIDGE.deckThickness).toBeGreaterThan(20);
  });

  it('bridge cars sit on the road surface between the two ends', () => {
    const hb = meta.landmarks.harbourBridge;
    const g = bridgeGeometry(hb);
    expect(g.length).toBeGreaterThan(1000);
    // Traffic keeps to the bridge itself.
    expect(g.road.from).toBeGreaterThanOrEqual(0);
    expect(g.road.to).toBeLessThanOrEqual(g.length);
    expect(g.road.to - g.road.from).toBeGreaterThan(900);
    for (let i = 0; i < 36; i++) {
      const car = bridgeCar(i, 36, g.length, 123.4);
      const p = g.at(car.s, car.lateral);
      expect(p.y).toBeGreaterThanOrEqual(Math.min(...hb.deckY) - 1e-6);
      expect(p.y).toBeLessThanOrEqual(Math.max(...hb.deckY) + 1e-6);
      expect(p.x).toBeGreaterThan(meta.bounds.minX);
      expect(p.x).toBeLessThan(meta.bounds.maxX);
    }
  });
});
