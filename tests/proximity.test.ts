import { describe, expect, it } from 'vitest';
import type { StopPlacement } from '../src/app/contracts';
import { createProximity } from '../src/flight/proximity';

const stop = (id: 'projects' | 'work', x: number, z: number): StopPlacement => ({
  id,
  hotkey: 1,
  label: id.toUpperCase(),
  place: 'x',
  color: 'pohutukawa',
  icon: 'code',
  x,
  z,
  groundY: 10,
  baseY: 20,
  triggerRadius: 200,
  orbitRadius: 220,
  orbitY: 150,
});

describe('proximity', () => {
  it('enters at the trigger radius and exits 60 m later (hysteresis)', () => {
    const prox = createProximity([stop('projects', 0, 0)]);
    expect(prox.update({ x: 400, y: 100, z: 0 })).toEqual({ current: null, entered: null, exited: null });
    expect(prox.update({ x: 201, y: 100, z: 0 }).current).toBeNull();
    expect(prox.update({ x: 199, y: 100, z: 0 })).toEqual({ current: 'projects', entered: 'projects', exited: null });
    // inside, no repeat event
    expect(prox.update({ x: 150, y: 100, z: 0 })).toEqual({ current: 'projects', entered: null, exited: null });
    // between 200 and 260: stays current
    expect(prox.update({ x: 255, y: 100, z: 0 })).toEqual({ current: 'projects', entered: null, exited: null });
    expect(prox.update({ x: 261, y: 100, z: 0 })).toEqual({ current: null, entered: null, exited: 'projects' });
    // outside the enter radius, within the exit radius: not re-entered
    expect(prox.update({ x: 230, y: 100, z: 0 }).current).toBeNull();
    expect(prox.update({ x: 100, y: 100, z: 0 }).entered).toBe('projects');
  });

  it('respects the height band (ground to +400 m)', () => {
    const prox = createProximity([stop('work', 0, 0)]);
    expect(prox.update({ x: 0, y: 700, z: 0 }).current).toBeNull();
    expect(prox.update({ x: 0, y: 300, z: 0 }).entered).toBe('work');
    expect(prox.update({ x: 0, y: 700, z: 0 }).exited).toBe('work');
  });

  it('picks the nearest stop and swaps cleanly', () => {
    const prox = createProximity([stop('projects', 0, 0), stop('work', 300, 0)]);
    expect(prox.update({ x: 120, y: 100, z: 0 }).current).toBe('projects');
    const r = prox.update({ x: 450, y: 100, z: 0 });
    expect(r.exited).toBe('projects');
    expect(r.current).toBe('work');
    expect(r.entered).toBe('work');
  });
});
