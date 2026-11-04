import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightState } from '../src/app/contracts';
import { createChaseCamera } from '../src/flight/camera';
import { createPlane } from '../src/flight/plane';
import { FAKE_DIR, loadWorld } from './flightWorld';

const { world } = loadWorld(FAKE_DIR);
const DEG = Math.PI / 180;
const st = (over: Partial<FlightState> = {}): FlightState => ({
  pos: { x: 100, y: 300, z: -200 },
  heading: 0,
  pitch: 0,
  bank: 0,
  speed: 55,
  vy: 0,
  boost: 1,
  boosting: false,
  ...over,
});

describe('plane model', () => {
  it('has a ~12 m wingspan', () => {
    const p = createPlane();
    p.update(st(), 0);
    p.object.updateMatrixWorld(true);
    const b = new Box3().setFromObject(p.object);
    expect(b.max.x - b.min.x).toBeGreaterThan(11.5);
    expect(b.max.x - b.min.x).toBeLessThan(13.5);
  });

  it('nose points along the flight direction for heading, pitch and bank', () => {
    const p = createPlane();
    for (const [heading, pitch] of [
      [0, 0],
      [Math.PI / 2, 0],
      [Math.PI, 20 * DEG],
      [2.3, -15 * DEG],
    ]) {
      p.update(st({ heading, pitch, bank: 30 * DEG }), 0);
      p.object.updateMatrixWorld(true);
      const nose = new Vector3(0, 0, -1).transformDirection(p.object.matrixWorld);
      const cp = Math.cos(pitch);
      expect(nose.x).toBeCloseTo(Math.sin(heading) * cp, 5);
      expect(nose.z).toBeCloseTo(-Math.cos(heading) * cp, 5);
      expect(nose.y).toBeCloseTo(Math.sin(pitch), 5);
    }
  });

  it('positive bank drops the right wing', () => {
    const p = createPlane();
    p.update(st({ heading: 0, bank: 30 * DEG }), 0);
    p.object.updateMatrixWorld(true);
    const right = new Vector3(1, 0, 0).transformDirection(p.object.matrixWorld);
    expect(right.y).toBeLessThan(-0.4);
    p.update(st({ heading: Math.PI / 2, bank: 0 }), 0);
    p.object.updateMatrixWorld(true);
    // heading east: the right wing points south (+z)
    const r2 = new Vector3(1, 0, 0).transformDirection(p.object.matrixWorld);
    expect(r2.z).toBeCloseTo(1, 5);
  });
});

describe('chase camera', () => {
  it('snaps 18 m behind and 6 m above, looking ahead', () => {
    const c = createChaseCamera();
    expect(c.camera.near).toBe(0.5);
    expect(c.camera.far).toBe(3500);
    c.snap(st({ heading: Math.PI / 2 }));
    expect(c.camera.position.x).toBeCloseTo(100 - 18, 3);
    expect(c.camera.position.y).toBeCloseTo(306, 3);
    expect(c.camera.position.z).toBeCloseTo(-200, 3);
    const dir = new Vector3();
    c.camera.getWorldDirection(dir);
    expect(dir.x).toBeGreaterThan(0.9);
    expect(c.camera.fov).toBeCloseTo(60, 3);
  });

  it('follows with a critically damped spring and keeps up during warp', () => {
    const lagAt = (warp: number) => {
      const c = createChaseCamera();
      const s = st({ pos: { x: 0, y: 400, z: 0 }, heading: 0 });
      c.snap(s);
      for (let i = 0; i < 240; i++) {
        s.pos.z -= (55 * warp) / 60; // flying north
        c.update(1 / 60, s, world, warp);
      }
      return c.camera.position.z - (s.pos.z + 18);
    };
    const l1 = lagAt(1);
    const l8 = lagAt(8);
    expect(l1).toBeGreaterThan(0);
    expect(l1).toBeLessThan(40);
    expect(l8).toBeLessThan(l1 * 3);
  });

  it('widens the FOV on boost, rolls with bank and stays above the ground', () => {
    const c = createChaseCamera();
    const s = st({ boosting: true, bank: 30 * DEG });
    c.snap(s);
    for (let i = 0; i < 180; i++) c.update(1 / 60, s, world, 1);
    expect(c.camera.fov).toBeGreaterThan(66);
    expect(c.camera.fov).toBeLessThanOrEqual(68.01);
    // camera right vector tilts down on the right for a right bank
    const right = new Vector3(1, 0, 0).applyQuaternion(c.camera.quaternion);
    expect(right.y).toBeLessThan(0);

    const low = st({ pos: { x: 100, y: 0.5, z: -200 } });
    c.snap(low);
    c.update(1 / 60, low, world, 1);
    expect(c.camera.position.y).toBeGreaterThanOrEqual(world.solidAt(c.camera.position.x, c.camera.position.z) + 3 - 1e-6);
  });

  it('keeps a sensible horizontal FOV on portrait screens', () => {
    const c = createChaseCamera();
    c.setAspect(390 / 844);
    const hfov = 2 * Math.atan(Math.tan((c.camera.fov * DEG) / 2) * c.camera.aspect);
    expect(hfov / DEG).toBeGreaterThan(48);
    expect(c.camera.fov).toBeLessThanOrEqual(90);
    c.setAspect(16 / 9);
    expect(c.camera.fov).toBeCloseTo(60, 3);
  });
});
