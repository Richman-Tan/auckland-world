import { describe, expect, it } from 'vitest';
import type { Controls } from '../src/app/contracts';
import { FLIGHT, createFlightSim } from '../src/flight/flightModel';
import { FAKE_DIR, loadWorld, rng } from './flightWorld';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const { world, meta } = loadWorld(FAKE_DIR);

/** A high, flat-ish spot with nothing around it (open water east of the CBD is below sea level). */
function openSpot() {
  return { x: 1500, z: -500 };
}

describe('flight model', () => {
  it('survives 10k steps of seeded random input: no NaN, speed in [35,130], never above 600 m', () => {
    const rand = rng(7);
    const sim = createFlightSim();
    sim.reset({ pos: { x: 0, y: 300, z: 0 }, heading: 1 });
    let c: Controls = { turn: 0, pitch: 0, boost: false };
    let climbBias = 0;
    for (let i = 0; i < 10000; i++) {
      if (i % 30 === 0) {
        climbBias = rand() < 0.2 ? 1 : 0; // push towards the ceiling now and then
        c = { turn: rand() * 2 - 1, pitch: climbBias ? 1 : rand() * 2 - 1, boost: rand() < 0.4 };
      }
      sim.step(DT, c, world);
      const s = sim.state;
      expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.heading + s.pitch + s.bank + s.speed + s.vy + s.boost)).toBe(true);
      expect(s.speed).toBeGreaterThanOrEqual(35 - 1e-9);
      expect(s.speed).toBeLessThanOrEqual(130 + 1e-9);
      expect(s.pos.y).toBeLessThanOrEqual(600 + 1e-9);
      expect(s.boost).toBeGreaterThanOrEqual(0);
      expect(s.boost).toBeLessThanOrEqual(1);
    }
  });

  it('shrugs off garbage input', () => {
    const sim = createFlightSim();
    sim.reset({ pos: { x: 0, y: 300, z: 0 }, heading: 0 });
    for (let i = 0; i < 600; i++) {
      sim.step(i % 2 ? NaN : DT, { turn: NaN, pitch: Infinity, boost: true }, world);
    }
    expect(Number.isFinite(sim.state.pos.y)).toBe(true);
    expect(sim.state.speed).toBeGreaterThanOrEqual(35);
  });

  it('turn right gives right-wing-down (positive) bank and a clockwise heading change', () => {
    const sim = createFlightSim();
    sim.reset({ pos: { x: 0, y: 300, z: 0 }, heading: 0 });
    for (let i = 0; i < 60; i++) sim.step(DT, { turn: 1, pitch: 0, boost: false }, world);
    expect(sim.state.bank).toBeGreaterThan(30 * DEG);
    expect(sim.state.bank).toBeLessThanOrEqual(40 * DEG + 1e-9);
    expect(sim.state.heading).toBeGreaterThan(0.5);
    expect(sim.state.heading).toBeLessThan(Math.PI);
  });

  it('flies the documented speeds and yaw rate', () => {
    const sim = createFlightSim();
    sim.reset({ pos: { x: 0, y: 300, z: 0 }, heading: 0 });
    for (let i = 0; i < 600; i++) sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
    expect(sim.state.speed).toBeCloseTo(55, 0);
    const h0 = sim.state.heading;
    for (let i = 0; i < 60; i++) sim.step(DT, { turn: 1, pitch: 0, boost: false }, world);
    const unwrapped = (sim.state.heading - h0 + 2 * Math.PI) % (2 * Math.PI);
    expect(unwrapped / DEG).toBeGreaterThan(35);
    expect(unwrapped / DEG).toBeLessThan(55);
  });

  it('boost drains at 25%/s, then recharges at 12%/s after a 0.8 s delay', () => {
    const sim = createFlightSim();
    sim.reset({ pos: { x: 0, y: 300, z: 0 }, heading: 0 });
    for (let i = 0; i < 60; i++) sim.step(DT, { turn: 0, pitch: 0, boost: true }, world);
    expect(sim.state.boost).toBeCloseTo(0.75, 1);
    expect(sim.state.boosting).toBe(true);
    for (let i = 0; i < 60 * 0.7; i++) sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
    expect(sim.state.boost).toBeCloseTo(0.75, 2);
    for (let i = 0; i < 60 * 1.8; i++) sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
    expect(sim.state.boost).toBeCloseTo(0.75 + 0.12 * 1.7, 1);
    // hold boost until empty: cannot exceed 130 m/s and stops boosting when empty
    for (let i = 0; i < 60 * 8; i++) sim.step(DT, { turn: 0, pitch: 0, boost: true }, world);
    expect(sim.state.speed).toBeLessThanOrEqual(130 + 1e-9);
    expect(sim.state.boost).toBeLessThan(0.25);
  });

  it('returns to level (bank and pitch under 3 deg) within 2 s of releasing input', () => {
    for (const [turn, pitch] of [
      [1, 1],
      [-1, -1],
      [1, -1],
    ] as const) {
      const sim = createFlightSim();
      sim.reset({ pos: { x: 0, y: 300, z: 0 }, heading: 0 });
      for (let i = 0; i < 90; i++) sim.step(DT, { turn, pitch, boost: false }, world);
      expect(Math.abs(sim.state.bank)).toBeGreaterThan(20 * DEG);
      for (let i = 0; i < 120; i++) sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
      expect(Math.abs(sim.state.bank)).toBeLessThan(3 * DEG);
      expect(Math.abs(sim.state.pitch)).toBeLessThan(3 * DEG);
    }
  });

  it('applies the soft ceiling: holding nose-up never passes 600 m', () => {
    const sim = createFlightSim();
    sim.reset({ pos: { x: 0, y: 500, z: 0 }, heading: 0 });
    let maxY = 0;
    for (let i = 0; i < 60 * 40; i++) {
      sim.step(DT, { turn: 0, pitch: 1, boost: false }, world);
      maxY = Math.max(maxY, sim.state.pos.y);
    }
    expect(maxY).toBeLessThanOrEqual(600);
    expect(maxY).toBeGreaterThan(540);
  });

  it('collision from above lifts the plane clear of the ground', () => {
    const sim = createFlightSim();
    const { x, z } = openSpot();
    const ground = world.solidAt(x, z);
    sim.reset({ pos: { x, y: ground + 1, z }, heading: 0 });
    const r = sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
    expect(r.collided).toBe(true);
    expect(['ground', 'water', 'building']).toContain(r.hit);
    expect(sim.state.pos.y).toBeGreaterThanOrEqual(world.solidAt(sim.state.pos.x, sim.state.pos.z) + 3 - 1e-6);
    expect(sim.state.vy).toBeGreaterThan(5);
    const y0 = sim.state.pos.y;
    for (let i = 0; i < 20; i++) sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
    expect(sim.state.pos.y).toBeGreaterThan(y0);
  });

  it('hitting a tall building side-on bounces back to the previous position and slows down', () => {
    // find a building cell whose neighbour to the west is much lower
    let found: { x: number; z: number } | null = null;
    for (let x = -1500; x < 1500 && !found; x += 6) {
      for (let z = -1500; z < 1500; z += 6) {
        const here = world.solidAt(x, z);
        const w1 = world.solidAt(x - 6, z);
        if (here > w1 + 40 && Math.abs(world.solidAt(x - 12, z) - w1) < 2 && Math.abs(world.solidAt(x - 30, z) - w1) < 3 && Math.abs(world.solidAt(x - 40, z) - w1) < 3) {
          found = { x, z };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const sim = createFlightSim();
    const f = found!;
    const ground = world.solidAt(f.x - 30, f.z);
    sim.reset({ pos: { x: f.x - 30, y: ground + 15, z: f.z }, heading: Math.PI / 2, speed: 55 });
    let hit: string | undefined;
    for (let i = 0; i < 120 && !hit; i++) {
      const r = sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
      if (r.collided) hit = r.hit;
    }
    expect(hit).toBe('building');
    expect(sim.state.speed).toBeLessThan(45); // halved but floored at 35
    expect(sim.state.pos.x).toBeLessThan(f.x);
    // heading no longer points east
    expect(Math.sin(sim.state.heading)).toBeLessThan(0.7);
  });

  it('three hits within 3 s respawn at the last safe snapshot', () => {
    const sim = createFlightSim();
    const { x, z } = openSpot();
    const safe = { x: x + 200, y: world.solidAt(x + 200, z) + 120, z };
    sim.reset({ pos: safe, heading: 0.3 });
    // fly safely for 2.5 s so a snapshot is taken
    for (let i = 0; i < 150; i++) sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
    const snapPos = { ...sim.state.pos };
    let respawned = false;
    let hits = 0;
    for (let i = 0; i < 3; i++) {
      // teleport into the ground and step
      sim.state.pos.x = x;
      sim.state.pos.z = z;
      sim.state.pos.y = world.solidAt(x, z) + 0.5;
      const r = sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
      if (r.collided) hits++;
      if (r.respawned) respawned = true;
    }
    expect(hits).toBe(3);
    expect(respawned).toBe(true);
    expect(Math.hypot(sim.state.pos.x - snapPos.x, sim.state.pos.z - snapPos.z)).toBeLessThan(120);
    expect(sim.state.pos.y - world.solidAt(sim.state.pos.x, sim.state.pos.z)).toBeGreaterThan(40);
  });

  it('flags pullUp when the ground is closing and nudges the nose up', () => {
    // fly at the summit side of the highest terrain
    const sim = createFlightSim();
    const { x, z } = openSpot();
    sim.reset({ pos: { x, y: world.solidAt(x, z) + 8, z }, heading: 0, speed: 55 });
    const r = sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
    expect(r.pullUp).toBe(true);
    for (let i = 0; i < 20; i++) sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
    expect(sim.state.pitch).toBeGreaterThan(2 * DEG);
  });

  it('turns back when beyond bounds + 200 m', () => {
    const sim = createFlightSim();
    sim.reset({ pos: { x: meta.bounds.maxX + 400, y: 300, z: 0 }, heading: Math.PI / 2 }); // flying east, away
    let flagged = false;
    for (let i = 0; i < 60 * 20; i++) {
      const r = sim.step(DT, { turn: 0, pitch: 0, boost: false }, world);
      if (r.outOfBounds) flagged = true;
    }
    expect(flagged).toBe(true);
    expect(sim.state.pos.x).toBeLessThan(meta.bounds.maxX + 400);
  });

  it('exposes tuning constants', () => {
    expect(FLIGHT.vMin).toBe(35);
    expect(FLIGHT.vBoost).toBe(130);
  });
});
