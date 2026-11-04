import { describe, expect, it } from 'vitest';
import { createAutopilot } from '../src/flight/autopilot';
import { createFlightSim } from '../src/flight/flightModel';
import { FAKE_DIR, loadWorld } from './flightWorld';

const { meta, world, stops } = loadWorld(FAKE_DIR);
const DT = 1 / 60;
const byId = (id: string) => stops.find((s) => s.id === id)!;

describe('autopilot behaviour', () => {
  it('goes through climb, cruise, descend, arrive; never teleports; warp stays in range', () => {
    const target = byId('study');
    const sim = createFlightSim();
    sim.reset({ pos: { x: -2400, y: world.solidAt(-2400, 1800) + 80, z: 1800 }, heading: 0 });
    const ap = createAutopilot(target, world, sim.state);
    const phases: string[] = [];
    let maxJump = 0;
    let lastProgress = 0;
    let maxWarp = 0;
    let t = 0;
    while (!ap.status().arrived && t < 120) {
      const before = { ...sim.state.pos };
      sim.step(DT, ap.update(sim.state, world), world);
      t += DT;
      maxJump = Math.max(maxJump, Math.hypot(sim.state.pos.x - before.x, sim.state.pos.y - before.y, sim.state.pos.z - before.z));
      const s = ap.status();
      if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
      expect(s.warp).toBeGreaterThanOrEqual(1);
      expect(s.warp).toBeLessThanOrEqual(8);
      expect(s.etaS).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeGreaterThanOrEqual(lastProgress - 0.02);
      lastProgress = s.progress;
      maxWarp = Math.max(maxWarp, s.warp);
    }
    expect(ap.status().arrived).toBe(true);
    expect(ap.status().progress).toBe(1);
    expect(phases).toEqual(['climb', 'cruise', 'descend', 'arrive']);
    expect(maxJump).toBeLessThan(130 / 60 + 0.5); // no teleporting
    expect(maxWarp).toBeGreaterThan(4);
  });

  it('detours around the Sky Tower when it is on the straight line', () => {
    const st = meta.landmarks.skyTower;
    const target = byId('talk'); // north-west of the tower
    // start south-east of the tower on the line through it to the target
    const dx = target.x - st.x;
    const dz = target.z - st.z;
    const l = Math.hypot(dx, dz);
    const sx = st.x - (dx / l) * 1500;
    const sz = st.z - (dz / l) * 1500;
    const sim = createFlightSim();
    sim.reset({ pos: { x: sx, y: world.solidAt(sx, sz) + 250, z: sz }, heading: Math.atan2(dx, -dz) });
    const ap = createAutopilot(target, world, sim.state);
    let minD = Infinity;
    let collisions = 0;
    let t = 0;
    while (!ap.status().arrived && t < 120) {
      if (sim.step(DT, ap.update(sim.state, world), world).collided) collisions++;
      t += DT;
      minD = Math.min(minD, Math.hypot(sim.state.pos.x - st.x, sim.state.pos.z - st.z));
    }
    expect(ap.status().arrived).toBe(true);
    expect(collisions).toBe(0);
    expect(minD).toBeGreaterThan(110);
  });

  it('flies to the Sky Tower stop itself and holds the orbit without touching it', () => {
    const target = byId('projects');
    const sim = createFlightSim();
    sim.reset({ pos: { x: 1800, y: world.solidAt(1800, 1500) + 80, z: 1500 }, heading: 3 });
    const ap = createAutopilot(target, world, sim.state);
    let t = 0;
    let collisions = 0;
    while (!ap.status().arrived && t < 120) {
      if (sim.step(DT, ap.update(sim.state, world), world).collided) collisions++;
      t += DT;
    }
    expect(ap.status().arrived).toBe(true);
    expect(collisions).toBe(0);
  });
});
