import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CAR_HALF_WIDTH,
  BRIDGE_LANES,
  BRIDGE_LANES_FIT,
  BRIDGE_MEDIAN_HALF_WIDTH,
  BRIDGE_TRUSS_BAND,
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
import { bridgeModel } from '../src/shared/bridge';
import { HARBOUR_BRIDGE } from '../src/shared/collision';
import { LANE_WIDTH } from '../src/shared/roads';
import { TRUSS_PLANE } from '../src/world/landmarks/harbourBridge';
import { BRIDGE_CLIP_ON_CENTRE, bridgeStrips } from '../src/world/ribbons';
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

  it('has four lanes each way: two between the trusses and two on the clip-on, none of them through the steel', () => {
    expect(BRIDGE_LANES_FIT).toBe(true);
    expect(BRIDGE_LANES).toHaveLength(4);
    const [inner, outer] = BRIDGE_TRUSS_BAND;
    // The truss the model draws is inside the band the lanes are kept out of.
    expect(inner).toBeLessThanOrEqual(TRUSS_PLANE - 1.3 + 1e-9);
    expect(outer).toBeGreaterThanOrEqual(TRUSS_PLANE + 1.3 - 1e-9);
    expect(outer).toBeLessThanOrEqual(HARBOUR_BRIDGE.trussHalfWidth);
    const inside = BRIDGE_LANES.filter((l) => l + BRIDGE_CAR_HALF_WIDTH <= inner);
    const outside = BRIDGE_LANES.filter((l) => l - BRIDGE_CAR_HALF_WIDTH >= outer);
    expect(inside).toHaveLength(2);
    expect(outside).toHaveLength(2);
    // Cars in neighbouring lanes do not overlap, and the outermost is on the road, inside the parapet.
    const sorted = [...BRIDGE_LANES].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(2 * BRIDGE_CAR_HALF_WIDTH);
    expect(sorted[0] - BRIDGE_CAR_HALF_WIDTH).toBeGreaterThan(BRIDGE_MEDIAN_HALF_WIDTH);
    expect(sorted[3] + BRIDGE_CAR_HALF_WIDTH).toBeLessThan(18);
    // And they are the lanes painted on the deck: the middle of each lane of each strip.
    const painted = bridgeStrips(loadWorld(FAKE_DIR).meta.landmarks.harbourBridge).flatMap((s) => {
      const centre = Math.abs(s.stations[0].x - bridgeModel(loadWorld(FAKE_DIR).meta.landmarks.harbourBridge).at(s.stations[0].along, 0).x) < 1e-6 ? 0 : BRIDGE_CLIP_ON_CENTRE;
      return Array.from({ length: s.lanes }, (_, k) => Math.abs(centre + (k - (s.lanes - 1) / 2) * LANE_WIDTH));
    });
    for (const lane of BRIDGE_LANES) expect(painted.some((p) => Math.abs(p - lane) < 0.01), `lane ${lane}`).toBe(true);
  });

  it('bridge traffic keeps left and stays on the deck', () => {
    const length = 1600;
    const used = new Set<number>();
    for (let t = 0; t < 400; t += 3.7) {
      for (let i = 0; i < 56; i++) {
        const car = bridgeCar(i, 56, length, t);
        expect(car.s).toBeGreaterThanOrEqual(0);
        expect(car.s).toBeLessThanOrEqual(length);
        used.add(car.lateral);
        expect(BRIDGE_LANES as readonly number[]).toContain(Math.abs(car.lateral));
        // Driving a to b you are on the -lateral side; coming back, on the other.
        expect(Math.sign(car.lateral)).toBe(car.forward ? -1 : 1);
      }
    }
    // Every lane of both directions carries something.
    expect(used.size).toBe(8);
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
    const main = bridgeModel(hb).piers.filter((p) => p.main);
    expect(main).toHaveLength(2);
    const [pierA, pierB] = main.map((p) => p.s / g.length);
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
