import { describe, expect, it } from 'vitest';
import { createFlightSim } from '../src/flight/flightModel';
import { createOrbit } from '../src/flight/orbit';
import { FAKE_DIR, loadWorld } from './flightWorld';

const { world, stops } = loadWorld(FAKE_DIR);

describe('orbit', () => {
  for (const stop of stops) {
    it(`holds a steady circle around ${stop.id} for 60 s with no collision`, () => {
      const orbit = createOrbit(stop);
      const sim = createFlightSim();
      // start on the circle, tangent heading (clockwise), at orbit altitude
      const start = { x: stop.x + stop.orbitRadius, z: stop.z };
      sim.reset({ pos: { x: start.x, y: stop.orbitY, z: start.z }, heading: Math.PI });
      let minR = Infinity;
      let maxR = 0;
      let collisions = 0;
      let minY = Infinity;
      let maxY = 0;
      // 10 s to settle, then measure for 60 s
      for (let i = 0; i < 60 * 70; i++) {
        const r = sim.step(1 / 60, orbit.update(sim.state, world), world);
        if (r.collided) collisions++;
        if (i >= 600) {
          const d = Math.hypot(sim.state.pos.x - stop.x, sim.state.pos.z - stop.z);
          minR = Math.min(minR, d);
          maxR = Math.max(maxR, d);
          minY = Math.min(minY, sim.state.pos.y);
          maxY = Math.max(maxY, sim.state.pos.y);
        }
      }
      expect(collisions).toBe(0);
      expect(minR).toBeGreaterThan(stop.orbitRadius * 0.75);
      expect(maxR).toBeLessThan(stop.orbitRadius * 1.25);
      expect(Math.abs((minY + maxY) / 2 - stop.orbitY)).toBeLessThan(60);
    });
  }

  it('captures an orbit from outside the circle, off-tangent', () => {
    const stop = stops[2];
    const orbit = createOrbit(stop);
    const sim = createFlightSim();
    sim.reset({ pos: { x: stop.x - 900, y: stop.orbitY + 40, z: stop.z + 300 }, heading: 0.2 });
    let collisions = 0;
    for (let i = 0; i < 60 * 60; i++) {
      if (sim.step(1 / 60, orbit.update(sim.state, world), world).collided) collisions++;
    }
    const d = Math.hypot(sim.state.pos.x - stop.x, sim.state.pos.z - stop.z);
    expect(collisions).toBe(0);
    expect(d).toBeGreaterThan(stop.orbitRadius * 0.75);
    expect(d).toBeLessThan(stop.orbitRadius * 1.25);
  });
});
