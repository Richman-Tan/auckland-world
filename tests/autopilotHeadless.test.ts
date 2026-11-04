import { describe, expect, it } from 'vitest';
import { createAutopilot } from '../src/flight/autopilot';
import { createFlightSim } from '../src/flight/flightModel';
import { FAKE_DIR, REAL_DIR, loadWorld, realMapExists, rng } from './flightWorld';

const DT = 1 / 60;
const MAX_SIM_S = 120;
const STARTS = Number(process.env.AW_STARTS ?? 20);

function runSuite(label: string, dir: string, seed: number) {
  const { meta, world, stops } = loadWorld(dir);
  const times: number[] = [];
  const failures: string[] = [];
  let collisions = 0;
  let respawns = 0;
  const rand = rng(seed);
  const b = meta.bounds;
  const margin = 500;
  for (let i = 0; i < STARTS; i++) {
    const x = b.minX + margin + rand() * (b.maxX - b.minX - 2 * margin);
    const z = b.minZ + margin + rand() * (b.maxZ - b.minZ - 2 * margin);
    const heading = rand() * Math.PI * 2;
    const y = world.solidAt(x, z) + 80;
    for (const stop of stops) {
      const sim = createFlightSim();
      sim.reset({ pos: { x, y, z }, heading });
      const ap = createAutopilot(stop, world, sim.state);
      let t = 0;
      let runCollisions = 0;
      let firstHit = '';
      while (t < MAX_SIM_S && !ap.status().arrived) {
        const r = sim.step(DT, ap.update(sim.state, world), world);
        t += DT;
        if (r.collided) {
          runCollisions++;
          if (!firstHit) firstHit = `${r.hit} @${t.toFixed(1)}s phase ${ap.status().phase}`;
        }
        if (r.respawned) respawns++;
      }
      collisions += runCollisions;
      if (runCollisions > 0 || !ap.status().arrived) {
        failures.push(
          `${label} start#${i} (${x.toFixed(0)},${z.toFixed(0)}) -> ${stop.id}: arrived=${ap.status().arrived} t=${t.toFixed(1)} collisions=${runCollisions} ${firstHit}`,
        );
      } else times.push(t);
    }
  }
  const sorted = [...times].sort((a, c) => a - c);
  const median = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted[sorted.length - 1];
  console.log(
    `[autopilot ${label}] runs=${STARTS * stops.length} arrived=${times.length} worst=${worst?.toFixed(1)}s median=${median?.toFixed(1)}s collisions=${collisions} respawns=${respawns}`,
  );
  return { failures, collisions, runs: STARTS * stops.length, arrived: times.length };
}

describe('autopilot headless (fake map)', () => {
  it('arrives from 20 seeded starts to all stops within 120 s with zero collisions', { timeout: 300000 }, () => {
    const r = runSuite('fake', FAKE_DIR, Number(process.env.AW_SEED ?? 20261105));
    expect(r.failures).toEqual([]);
    expect(r.collisions).toBe(0);
    expect(r.arrived).toBe(r.runs);
  });
});

describe.skipIf(!realMapExists)('autopilot headless (real map)', () => {
  it('arrives from 20 seeded starts to all stops within 120 s with zero collisions', { timeout: 600000 }, () => {
    const r = runSuite('real', REAL_DIR, 20261105);
    expect(r.failures).toEqual([]);
    expect(r.collisions).toBe(0);
    expect(r.arrived).toBe(r.runs);
  });
});
