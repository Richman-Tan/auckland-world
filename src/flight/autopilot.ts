/**
 * Autopilot: a planner plus a controller that outputs the same Controls a player would. It never
 * touches the simulation state. See docs/PLAN.md for the phase rules.
 */
import type { Autopilot, AutopilotStatus, Collider, Controls, FlightState, StopPlacement, WorldQuery } from '../app/contracts';
import { SKY_TOWER } from '../shared/collision';
import { FLIGHT } from './flightModel';
import {
  DEG,
  altitudePitch,
  clamp,
  colliderTop,
  createTerrainGuard,
  headingTo,
  nearbyColliders,
  orbitControls,
  turnFor,
  wrapPi,
} from './guidance';

export const AUTOPILOT = {
  corridor: 60,
  sampleStep: 12,
  cruiseClearance: 60,
  cruiseMin: 150,
  cruiseMax: 520,
  towerAvoid: 150,
  towerSide: 200,
  boostFarM: 1500,
  descentAngle: 10 * DEG,
  arriveFactor: 1.2,
  waypointReach: 90,
} as const;

interface Plan {
  waypoint: { x: number; z: number } | null;
  cruiseY: number;
  totalM: number;
  colliders: Collider[];
}

function segPointDistance(ax: number, az: number, bx: number, bz: number, px: number, pz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t, x: ax + dx * t, z: az + dz * t };
}

function plan(target: StopPlacement, world: WorldQuery, from: FlightState): Plan {
  const fx = from.pos.x;
  const fz = from.pos.z;
  let waypoint: { x: number; z: number } | null = null;

  const tower = world.colliders.find((c) => c.name.startsWith('Sky Tower') && c.kind === 'cylinder');
  if (tower && tower.kind === 'cylinder' && target.id !== 'projects') {
    const near = segPointDistance(fx, fz, target.x, target.z, tower.x, tower.z);
    if (near.d - SKY_TOWER.podRadius < AUTOPILOT.towerAvoid) {
      // Put the waypoint 200 m from the tower axis on the side the route already passes it on,
      // so the detour is the short way round.
      const dx = target.x - fx;
      const dz = target.z - fz;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len; // left normal in xz (arbitrary but fixed)
      const nz = dx / len;
      const side = (tower.x - near.x) * nx + (tower.z - near.z) * nz >= 0 ? -1 : 1;
      waypoint = { x: tower.x + nx * side * AUTOPILOT.towerSide, z: tower.z + nz * side * AUTOPILOT.towerSide };
    }
  }

  const legs: Array<[number, number, number, number]> = waypoint
    ? [
        [fx, fz, waypoint.x, waypoint.z],
        [waypoint.x, waypoint.z, target.x, target.z],
      ]
    : [[fx, fz, target.x, target.z]];
  const colliders = nearbyColliders(world, [...legs, [target.x, target.z, target.x, target.z]], AUTOPILOT.corridor + 700);

  let top = -Infinity;
  let totalM = 0;
  for (const [ax, az, bx, bz] of legs) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    totalM += len;
    if (len < 1) continue;
    const ux = dx / len;
    const uz = dz / len;
    for (let s = 0; s <= len; s += AUTOPILOT.sampleStep) {
      const x = ax + ux * s;
      const z = az + uz * s;
      for (const off of [-AUTOPILOT.corridor, -AUTOPILOT.corridor / 2, 0, AUTOPILOT.corridor / 2, AUTOPILOT.corridor]) {
        const sx = x - uz * off;
        const sz = z + ux * off;
        top = Math.max(top, world.solidAt(sx, sz), colliderTop(colliders, sx, sz, 0));
      }
    }
  }
  const cruiseY = clamp(top + AUTOPILOT.cruiseClearance, AUTOPILOT.cruiseMin, AUTOPILOT.cruiseMax);
  return { waypoint, cruiseY, totalM, colliders };
}

export function createAutopilot(target: StopPlacement, world: WorldQuery, from: FlightState): Autopilot {
  const p = plan(target, world, from);
  const guard = createTerrainGuard(p.colliders);
  const arriveR = AUTOPILOT.arriveFactor * target.triggerRadius;
  let phase: AutopilotStatus['phase'] = from.pos.y >= p.cruiseY - 25 ? 'cruise' : 'climb';
  let waypoint = p.waypoint;
  let warp = 1;
  let etaS = 0;
  let progress = 0;
  let arrived = false;
  let arriveT = 0;

  function update(state: FlightState, w: WorldQuery): Controls {
    const { x, y, z } = state.pos;
    const dTarget = Math.hypot(target.x - x, target.z - z);
    if (waypoint && Math.hypot(waypoint.x - x, waypoint.z - z) < AUTOPILOT.waypointReach) waypoint = null;
    const aim = waypoint ?? target;
    const remaining = dTarget + (waypoint ? Math.hypot(waypoint.x - x, waypoint.z - z) : 0);

    // ---- phase transitions (arrive is latched)
    if (phase !== 'arrive') {
      if (dTarget < arriveR) phase = 'arrive';
      else if (phase === 'climb' && y >= p.cruiseY - 25) phase = 'cruise';
      else if (phase === 'cruise') {
        const dAlt = Math.abs(y - target.orbitY);
        if (dTarget - arriveR < dAlt / Math.tan(AUTOPILOT.descentAngle) && !waypoint) phase = 'descend';
      }
    }

    let controls: Controls;
    if (phase === 'arrive') {
      arriveT += 1 / 60;
      const needed = guard.pitchNeeded(state, w, 0.3);
      controls = orbitControls(state, target.x, target.z, target.orbitRadius, target.orbitY, needed);
      const radial = Math.abs(dTarget - target.orbitRadius) < 0.25 * target.orbitRadius;
      if (!arrived && arriveT > 1.5 && Math.abs(y - target.orbitY) < 25 && radial) arrived = true;
      if (!arrived && arriveT > 12 && radial && Math.abs(y - target.orbitY) < 60) arrived = true;
      warp = 1;
    } else {
      const err = wrapPi(headingTo(aim.x - x, aim.z - z) - state.heading);
      const turn = turnFor(err);
      const needed = guard.pitchNeeded(state, w, turn);
      let pitch: number;
      if (phase === 'descend') {
        pitch = altitudePitch(state, target.orbitY, AUTOPILOT.descentAngle, AUTOPILOT.descentAngle, needed);
        warp = needed > 5 * DEG ? 1 : 2;
      } else if (phase === 'climb') {
        pitch = altitudePitch(state, p.cruiseY, 10 * DEG, 22 * DEG, needed);
        warp = Math.abs(err) < 0.4 ? 2 : 1;
      } else {
        pitch = altitudePitch(state, p.cruiseY, 12 * DEG, 12 * DEG, needed);
        warp = clamp(remaining / 600, 1, 8);
      }
      const farEnough = phase === 'cruise' && remaining > AUTOPILOT.boostFarM && Math.abs(err) < 0.35;
      const boost = farEnough && (state.boosting ? state.boost > 0 : state.boost > 0.25);
      controls = { turn, pitch, boost };
    }

    progress = arrived ? 1 : clamp(1 - remaining / Math.max(p.totalM, 1), 0, 1);
    const spd = Math.max(state.speed, FLIGHT.vCruise);
    etaS = arrived ? 0 : remaining / spd / Math.max(warp, 1);
    return controls;
  }

  return {
    target,
    update,
    status(): AutopilotStatus {
      return { phase, warp, etaS, progress, arrived };
    },
  };
}
