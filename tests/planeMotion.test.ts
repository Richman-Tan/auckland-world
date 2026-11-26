import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightState } from '../src/app/contracts';
import { createPlane } from '../src/flight/plane';
import { MAX_DEFLECTION, shadowDirection, surfaceDeflections } from '../src/flight/planeMotion';
import { createSharedUniforms } from '../src/render/uniforms';

const DEG = Math.PI / 180;
const level = { heading: 0, pitch: 0, bank: 0 };
const st = (over: Partial<FlightState> = {}): FlightState => ({ pos: { x: 100, y: 300, z: -200 }, heading: 0, pitch: 0, bank: 0, speed: 55, vy: 0, boost: 1, boosting: false, ...over });

describe('control surfaces', () => {
  it('sit neutral in steady flight, whatever the attitude', () => {
    expect(surfaceDeflections(level, level, 1 / 60)).toEqual({ aileron: 0, elevator: 0, rudder: 0 });
    const banked = { heading: 1, pitch: 0.2, bank: 0.5 };
    expect(surfaceDeflections(banked, banked, 1 / 60)).toEqual({ aileron: 0, elevator: 0, rudder: 0 });
  });

  it('move the way the plane is turning: right roll, pitch up and right turn are positive', () => {
    const dt = 1 / 60;
    expect(surfaceDeflections(level, { ...level, bank: 0.005 }, dt).aileron).toBeGreaterThan(0);
    expect(surfaceDeflections(level, { ...level, bank: -0.005 }, dt).aileron).toBeLessThan(0);
    expect(surfaceDeflections(level, { ...level, pitch: 0.002 }, dt).elevator).toBeGreaterThan(0);
    expect(surfaceDeflections(level, { ...level, heading: 0.003 }, dt).rudder).toBeGreaterThan(0);
    // A harder roll is a bigger deflection.
    const gentle = surfaceDeflections(level, { ...level, bank: 0.002 }, dt).aileron;
    const hard = surfaceDeflections(level, { ...level, bank: 0.006 }, dt).aileron;
    expect(hard).toBeGreaterThan(gentle);
  });

  it('never swing past their stops, even when many steps land in one frame', () => {
    const wild = surfaceDeflections(level, { heading: 2, pitch: 1, bank: -3 }, 1 / 60);
    expect(wild.aileron).toBe(-MAX_DEFLECTION.aileron);
    expect(wild.elevator).toBe(MAX_DEFLECTION.elevator);
    expect(wild.rudder).toBe(MAX_DEFLECTION.rudder);
  });

  it('take the short way round the compass', () => {
    // 359 degrees to 1 degree is a small right turn, not a spin to the left.
    const d = surfaceDeflections({ ...level, heading: 359 * DEG }, { ...level, heading: 1 * DEG }, 0.5);
    expect(d.rudder).toBeGreaterThan(0);
    expect(d.rudder).toBeLessThan(MAX_DEFLECTION.rudder);
  });

  it('do nothing without a real time step', () => {
    expect(surfaceDeflections(level, { ...level, bank: 1 }, 0)).toEqual({ aileron: 0, elevator: 0, rudder: 0 });
    expect(surfaceDeflections(level, { ...level, bank: 1 }, -1)).toEqual({ aileron: 0, elevator: 0, rudder: 0 });
  });
});

describe("where the plane's shadow is cast from", () => {
  const elevation = (v: readonly number[]) => Math.atan2(v[1], Math.hypot(v[0], v[2])) / DEG;
  const bearing = (v: readonly number[]) => Math.atan2(v[0], -v[2]) / DEG;

  it('keeps a high sun exactly where it is', () => {
    const noon = [0.1, 0.99, -0.1];
    const len = Math.hypot(...noon);
    const unit = noon.map((n) => n / len) as [number, number, number];
    const out = shadowDirection(unit, 65);
    out.forEach((v, i) => expect(v).toBeCloseTo(unit[i], 6));
  });

  it('lifts a low sun to the minimum without changing its bearing', () => {
    const dusk: [number, number, number] = [-0.9, 0.17, -0.4];
    const out = shadowDirection(dusk, 65);
    expect(elevation(out)).toBeCloseTo(65, 4);
    expect(bearing(out)).toBeCloseTo(bearing(dusk), 4);
    expect(Math.hypot(...out)).toBeCloseTo(1, 6);
    // So from 100 m up the shadow lands within about 50 m, not a quarter of a kilometre away.
    expect((100 * Math.hypot(out[0], out[2])) / out[1]).toBeLessThan(50);
  });

  it('copes with a light straight overhead or below the horizon', () => {
    expect(shadowDirection([0, 1, 0], 65)).toEqual([0, 1, 0]);
    const under = shadowDirection([0.6, -0.2, 0.77], 65);
    expect(elevation(under)).toBeCloseTo(65, 4);
  });
});

describe('the plane model', () => {
  it('is one mesh with every attribute the material needs', () => {
    const p = createPlane();
    const meshes: { geometry: { getAttribute(n: string): { count: number; itemSize: number } | undefined; index: { count: number } | null } }[] = [];
    p.object.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes.push(o as never);
    });
    expect(meshes).toHaveLength(1);
    const g = meshes[0].geometry;
    const n = g.getAttribute('position')!.count;
    for (const [name, size] of [['aTint', 3], ['aGlow', 1], ['aPart', 1], ['aPivot', 3]] as const) {
      expect(g.getAttribute(name)!.count, name).toBe(n);
      expect(g.getAttribute(name)!.itemSize, name).toBe(size);
    }
    // Detailed, but still a small model: well under two thousand triangles.
    expect(g.index!.count / 3).toBeGreaterThan(600);
    expect(g.index!.count / 3).toBeLessThan(2000);
  });

  it('sits where it always did: nose forward, wheels below, fin above', () => {
    const p = createPlane();
    p.update(st({ pos: { x: 0, y: 0, z: 0 } }), 0);
    p.object.updateMatrixWorld(true);
    const b = new Box3().setFromObject(p.object);
    expect(b.min.z).toBeLessThan(-6); // the propeller, ahead of the nose
    expect(b.min.y).toBeLessThan(-2); // wheels
    expect(b.max.y).toBeGreaterThan(3); // fin
    expect(Math.abs(b.max.x + b.min.x)).toBeLessThan(0.01); // symmetrical
  });

  it('casts a shadow while it is shown and none while it is hidden', () => {
    const lighting = createSharedUniforms(3200);
    const p = createPlane(lighting);
    p.update(st({ heading: Math.PI / 2 }), 1);
    expect(lighting.uShadowK.value).toBeGreaterThan(0);
    expect(lighting.uShadowPos.value.toArray()).toEqual([100, 300, -200]);
    // Heading east: forward is +x, and the right wing points south (+z).
    expect(lighting.uShadowFwd.value.x).toBeCloseTo(1, 5);
    expect(lighting.uShadowRight.value.z).toBeCloseTo(1, 5);
    expect(lighting.uShadowDir.value.y).toBeGreaterThan(Math.sin(64 * DEG));
    p.object.visible = false;
    p.update(st(), 1.016);
    expect(lighting.uShadowK.value).toBe(0);
  });

  it('thins its shadow at night rather than losing it', () => {
    const lighting = createSharedUniforms(3200);
    lighting.uNight.value = 1;
    const p = createPlane(lighting);
    p.update(st(), 1);
    expect(lighting.uShadowK.value).toBeCloseTo(0.5, 6);
  });
});
