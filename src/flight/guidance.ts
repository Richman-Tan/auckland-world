/** Shared guidance helpers for the autopilot and the orbit: heading control and terrain lookahead. */
import type { Collider, Controls, FlightState, WorldQuery } from '../app/contracts';
import { FLIGHT, wrapPi } from './flightModel';

export { wrapPi };

export const DEG = Math.PI / 180;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Grid heading of the vector (dx, dz). */
export function headingTo(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/** Turn input for a heading error (rad, positive = target is to the right). */
export function turnFor(err: number): number {
  return clamp(err / 0.4, -1, 1);
}

/** Pitch input (-1..1) for a desired pitch angle. */
export function pitchInputFor(pitchRad: number): number {
  return clamp(pitchRad / FLIGHT.pitchMax, -1, 1);
}

/** Colliders whose footprint comes within `pad` of any of the given segments (a, b pairs). */
export function nearbyColliders(world: WorldQuery, segs: Array<[number, number, number, number]>, pad: number): Collider[] {
  const out: Collider[] = [];
  for (const c of world.colliders) {
    const cx = c.kind === 'cylinder' ? c.x : c.cx;
    const cz = c.kind === 'cylinder' ? c.z : c.cz;
    const ext = c.kind === 'cylinder' ? c.r : Math.hypot(c.hu, c.hv);
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? clamp(((cx - ax) * dx + (cz - az) * dz) / l2, 0, 1) : 0;
      if (Math.hypot(cx - (ax + dx * t), cz - (az + dz * t)) < pad + ext) {
        out.push(c);
        break;
      }
    }
  }
  return out;
}

/** Top (m ASL) of the highest collider within `margin` of (x, z), or -Infinity. */
export function colliderTop(colliders: readonly Collider[], x: number, z: number, margin: number): number {
  let top = -Infinity;
  for (const c of colliders) {
    if (c.y1 <= top) continue;
    if (c.kind === 'cylinder') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + margin) top = c.y1;
    } else {
      const dx = x - c.cx;
      const dz = z - c.cz;
      if (Math.abs(dx) + Math.abs(dz) > (c.hu + c.hv + margin) * 1.5) continue;
      const u = dx * c.ux + dz * c.uz;
      const v = -dx * c.uz + dz * c.ux;
      if (Math.abs(u) < c.hu + margin && Math.abs(v) < c.hv + margin) top = c.y1;
    }
  }
  return top;
}

export interface TerrainGuard {
  /**
   * Pitch (rad) needed to clear everything on the predicted path (arc of the current turn) by the
   * safety margin; -Infinity when nothing is ahead. Cached for a few calls.
   */
  pitchNeeded(state: FlightState, world: WorldQuery, turnCmd?: number): number;
  /** Highest obstacle top on the last lookahead (m ASL), for reporting. */
  readonly lastTop: number;
}

export const GUARD = { lookS: 6, step: 12, lateral: 14, margin: 35, bias: 3 * DEG, recompute: 4 } as const;

/**
 * Terrain lookahead with a fixed set of relevant colliders (so the per-step cost stays small).
 * `colliders` is the filtered list from nearbyColliders(); null = filter lazily around the plane.
 */
export function createTerrainGuard(colliders: Collider[] | null): TerrainGuard {
  let tick = 0;
  let cached = -Infinity;
  let lastTop = -Infinity;
  let cols = colliders;
  return {
    get lastTop() {
      return lastTop;
    },
    pitchNeeded(state, world, turnCmd = 0) {
      if (tick++ % GUARD.recompute !== 0) return cached;
      if (!cols) cols = nearbyColliders(world, [[state.pos.x, state.pos.z, state.pos.x, state.pos.z]], 3000);
      const spd = Math.max(state.speed, FLIGHT.vMin);
      // Yaw rate relaxes from its current value (from the bank) to the commanded one with the sim's tau.
      const yr0 = state.bank / FLIGHT.bankPerYawRate;
      const yrCmd = clamp(turnCmd, -1, 1) * FLIGHT.yawRateMax;
      let tt = 0;
      const n = Math.ceil((spd * GUARD.lookS) / GUARD.step);
      let h = state.heading;
      let x = state.pos.x;
      let z = state.pos.z;
      let need = -Infinity;
      let top = -Infinity;
      for (let i = 1; i <= n; i++) {
        const dts = GUARD.step / spd;
        tt += dts;
        h += (yrCmd + (yr0 - yrCmd) * Math.exp(-tt / FLIGHT.yawTau)) * dts;
        x += Math.sin(h) * GUARD.step;
        z -= Math.cos(h) * GUARD.step;
        const d = i * GUARD.step;
        const cx = Math.cos(h) * GUARD.lateral;
        const cz = Math.sin(h) * GUARD.lateral;
        let t = Math.max(world.solidAt(x, z), world.solidAt(x + cx, z + cz), world.solidAt(x - cx, z - cz));
        t = Math.max(t, colliderTop(cols, x, z, GUARD.margin));
        if (t > top) top = t;
        need = Math.max(need, Math.atan2(t + GUARD.margin - state.pos.y, d));
      }
      lastTop = top;
      cached = need === -Infinity ? -Infinity : need + GUARD.bias;
      return cached;
    },
  };
}

/**
 * Shared altitude-hold + terrain-guard pitch input. `slope` bounds the planned flight-path angle
 * (rad); the guard can only raise the result.
 */
export function altitudePitch(
  state: FlightState,
  targetY: number,
  slopeDown: number,
  slopeUp: number,
  guardPitch: number,
): number {
  const look = Math.max(state.speed * 2.5, 60);
  const plan = clamp(Math.atan2(targetY - state.pos.y, look), -slopeDown, slopeUp);
  const needed = guardPitch === -Infinity ? -Infinity : clamp(guardPitch, -Math.PI / 2, FLIGHT.pitchMax);
  return pitchInputFor(Math.max(plan, needed));
}

/** Controls to fly a constant circle around (cx, cz), clockwise seen from above (bank right). */
export function orbitControls(state: FlightState, cx: number, cz: number, radius: number, targetY: number, guardPitch: number): Controls {
  const dx = state.pos.x - cx;
  const dz = state.pos.z - cz;
  const r = Math.hypot(dx, dz) || 1e-6;
  // Clockwise tangent: (-dz, dx)/r, then rotated inward/outward by how far off the circle we are.
  const a = clamp(((r - radius) / radius) * 1.6, -0.9, 0.9);
  const tx = -dz / r;
  const tz = dx / r;
  const ux = dx / r;
  const uz = dz / r;
  const vx = tx * Math.cos(a) - ux * Math.sin(a);
  const vz = tz * Math.cos(a) - uz * Math.sin(a);
  const want = headingTo(vx, vz);
  const err = wrapPi(want - state.heading);
  const yawFF = state.speed / radius / FLIGHT.yawRateMax; // turn input that holds the circle
  return {
    turn: clamp(yawFF * Math.cos(a) + err / 0.5, -1, 1),
    pitch: altitudePitch(state, targetY, 10 * DEG, 10 * DEG, guardPitch),
    boost: false,
  };
}
