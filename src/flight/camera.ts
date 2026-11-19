import { PerspectiveCamera, Vector3 } from 'three';
import type { ChaseCamera, FlightState, WorldQuery } from '../app/contracts';

const DEG = Math.PI / 180;

export const CAMERA = {
  near: 0.5,
  far: 3500,
  behind: 18,
  behindBoost: 24,
  above: 6,
  lookAhead: 20,
  omega: 6,
  rollPerBank: 0.3,
  fov: 60,
  fovBoost: 68,
  minHFov: 50 * DEG,
  maxVFov: 90,
  minClearance: 3,
} as const;

export function createChaseCamera(): ChaseCamera {
  const camera = new PerspectiveCamera(CAMERA.fov, 16 / 9, CAMERA.near, CAMERA.far);
  camera.rotation.order = 'YXZ';
  const vel = new Vector3();
  const target = new Vector3();
  const look = new Vector3();
  let aspect = 16 / 9;
  let fov: number = CAMERA.fov;
  let behind: number = CAMERA.behind;
  let rollScale = 1;

  function desired(s: FlightState, dist: number, out: Vector3) {
    const cp = Math.cos(s.pitch * 0.6);
    out.set(
      s.pos.x - Math.sin(s.heading) * cp * dist,
      s.pos.y - Math.sin(s.pitch * 0.6) * dist + CAMERA.above,
      s.pos.z + Math.cos(s.heading) * cp * dist,
    );
  }

  function applyFov(dt: number, boosting: boolean) {
    const want = boosting ? CAMERA.fovBoost : CAMERA.fov;
    fov += (want - fov) * (1 - Math.exp(-dt * 4));
    // Keep the horizontal field of view sensible on portrait screens.
    const needV = (2 * Math.atan(Math.tan(CAMERA.minHFov / 2) / aspect)) / DEG;
    camera.fov = Math.min(Math.max(fov, needV), Math.max(fov, CAMERA.maxVFov));
    camera.updateProjectionMatrix();
  }

  function pose(s: FlightState, world: WorldQuery) {
    const floor = world.solidAt(camera.position.x, camera.position.z) + CAMERA.minClearance;
    if (camera.position.y < floor) camera.position.y = floor;
    const cp = Math.cos(s.pitch);
    look.set(
      s.pos.x + Math.sin(s.heading) * cp * CAMERA.lookAhead,
      s.pos.y + Math.sin(s.pitch) * CAMERA.lookAhead,
      s.pos.z - Math.cos(s.heading) * cp * CAMERA.lookAhead,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    // Roll with the bank (right wing down = clockwise seen from behind = -z rotation).
    camera.rotateZ(-CAMERA.rollPerBank * rollScale * s.bank);
  }

  return {
    camera,
    update(dt, s, world, warp) {
      const d = Math.min(Math.max(dt, 0), 0.25);
      if (!(d > 0)) return;
      behind += ((s.boosting ? CAMERA.behindBoost : CAMERA.behind) - behind) * (1 - Math.exp(-d * 3));
      desired(s, behind, target);
      // Critically damped spring, exact step: x(t) = T + (c1 + c2 t) e^{-wt}.
      const w = CAMERA.omega * Math.min(Math.max(warp, 1), 8);
      const e = Math.exp(-w * d);
      const p = camera.position;
      const c1x = p.x - target.x;
      const c1y = p.y - target.y;
      const c1z = p.z - target.z;
      const c2x = vel.x + w * c1x;
      const c2y = vel.y + w * c1y;
      const c2z = vel.z + w * c1z;
      p.set(target.x + (c1x + c2x * d) * e, target.y + (c1y + c2y * d) * e, target.z + (c1z + c2z * d) * e);
      vel.set((c2x - w * (c1x + c2x * d)) * e, (c2y - w * (c1y + c2y * d)) * e, (c2z - w * (c1z + c2z * d)) * e);
      applyFov(d, s.boosting);
      pose(s, world);
    },
    snap(s) {
      behind = s.boosting ? CAMERA.behindBoost : CAMERA.behind;
      desired(s, behind, camera.position);
      vel.set(0, 0, 0);
      fov = s.boosting ? CAMERA.fovBoost : CAMERA.fov;
      applyFov(0, s.boosting);
      look.set(0, 0, 0);
      camera.up.set(0, 1, 0);
      camera.lookAt(
        s.pos.x + Math.sin(s.heading) * CAMERA.lookAhead,
        s.pos.y,
        s.pos.z - Math.cos(s.heading) * CAMERA.lookAhead,
      );
      camera.rotateZ(-CAMERA.rollPerBank * rollScale * s.bank);
    },
    setRollScale(k) {
      rollScale = Math.min(Math.max(k, 0), 1);
    },
    setAspect(a) {
      aspect = Math.max(0.2, a || 1);
      camera.aspect = aspect;
      applyFov(0, false);
    },
  };
}
