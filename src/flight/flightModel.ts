/**
 * Arcade flight model. Pure (no three). Fixed step, no stalling, auto-levelling, forgiving
 * collisions. All numbers in FLIGHT are the tuning surface; the autopilot reads a few of them.
 */
import type { Collider, Controls, FlightSim, FlightState, FlightStepResult, Vec3, WorldQuery } from '../app/contracts';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const FLIGHT = {
  vMin: 35,
  vCruise: 55,
  vBoost: 130,
  boostDrain: 0.25,
  boostRecharge: 0.12,
  boostDelay: 0.8,
  yawRateMax: 55 * DEG,
  yawBoostScale: 0.75,
  yawTau: 0.15,
  bankMax: 40 * DEG,
  /** bank = bankPerYawRate * yawRate; positive yaw rate (turning right) gives positive bank (right wing down). */
  bankPerYawRate: (40 * DEG) / (55 * DEG),
  pitchMax: 30 * DEG,
  levelTau: 0.6,
  ceilingSoft: 550,
  ceilingHard: 600,
  assistClearance: 15,
  wingHalfSpan: 6,
  hitRadius: 2,
  boundsMargin: 200,
} as const;

export function wrapPi(a: number): number {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}
function wrap2Pi(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const unit = (v: unknown) => clamp(fin(v), -1, 1);

type Probe =
  | { kind: 'collider'; c: Collider; px: number; pz: number; k: number }
  | { kind: 'solid'; s: number; px: number; pz: number; k: number };

export function createFlightSim(): FlightSim {
  const state: FlightState = {
    pos: { x: 0, y: 150, z: 0 },
    heading: 0,
    pitch: 0,
    bank: 0,
    speed: FLIGHT.vCruise,
    vy: 0,
    boost: 1,
    boosting: false,
  };
  let yawRate = 0;
  let vyKick = 0;
  let time = 0;
  let lastBoostT = -10;
  let exhausted = false;
  let nextSnapT = 1;
  let hitTimes: number[] = [];
  let snap: { pos: Vec3; heading: number } = { pos: { ...state.pos }, heading: 0 };

  function reset(spawn: { pos: Vec3; heading: number; speed?: number }) {
    state.pos = { x: fin(spawn.pos.x), y: fin(spawn.pos.y, 150), z: fin(spawn.pos.z) };
    state.heading = wrap2Pi(fin(spawn.heading));
    state.pitch = 0;
    state.bank = 0;
    state.speed = clamp(fin(spawn.speed, FLIGHT.vCruise), FLIGHT.vMin, FLIGHT.vBoost);
    state.vy = 0;
    state.boost = 1;
    state.boosting = false;
    yawRate = 0;
    vyKick = 0;
    time = 0;
    lastBoostT = -10;
    exhausted = false;
    nextSnapT = 1;
    hitTimes = [];
    snap = { pos: { ...state.pos }, heading: state.heading };
  }

  function probe(world: WorldQuery, x: number, y: number, z: number, heading: number, bank: number): Probe | null {
    const ch = Math.cos(heading);
    const sh = Math.sin(heading);
    const sb = Math.sin(bank);
    let solidHit: Probe | null = null;
    let solidTop = -Infinity;
    for (const k of [0, 1, -1]) {
      const px = x + k * FLIGHT.wingHalfSpan * ch;
      const pz = z + k * FLIGHT.wingHalfSpan * sh;
      const py = y - k * FLIGHT.wingHalfSpan * sb;
      const c = world.hitCollider(px, py, pz, FLIGHT.hitRadius);
      if (c) return { kind: 'collider', c, px, pz, k };
      const s = world.solidAt(px, pz);
      if (py - FLIGHT.hitRadius < s && s > solidTop) {
        solidTop = s;
        solidHit = { kind: 'solid', s, px, pz, k };
      }
    }
    return solidHit;
  }

  function hitName(world: WorldQuery, p: Probe): string {
    if (p.kind === 'collider') return p.c.name;
    const g = world.groundAt(p.px, p.pz);
    if (p.s - g > 1) return 'building';
    return g <= world.waterLevel + 0.05 ? 'water' : 'ground';
  }

  /** Outward unit normal (xz) of a collider at a point. */
  function colliderNormal(c: Collider, x: number, z: number): [number, number] {
    if (c.kind === 'cylinder') {
      const dx = x - c.x;
      const dz = z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    }
    const dx = x - c.cx;
    const dz = z - c.cz;
    const u = dx * c.ux + dz * c.uz;
    const v = -dx * c.uz + dz * c.ux;
    const pu = c.hu + FLIGHT.hitRadius - Math.abs(u);
    const pv = c.hv + FLIGHT.hitRadius - Math.abs(v);
    if (pu < pv) {
      const s = u < 0 ? -1 : 1;
      return [c.ux * s, c.uz * s];
    }
    const s = v < 0 ? -1 : 1;
    return [-c.uz * s, c.ux * s];
  }

  function restoreFromSnapshot() {
    state.pos = { ...snap.pos };
    state.heading = snap.heading;
    state.pitch = 0;
    state.bank = 0;
    state.speed = FLIGHT.vCruise;
    state.vy = 0;
    yawRate = 0;
    vyKick = 0;
  }

  function step(dtIn: number, controls: Controls, world: WorldQuery): FlightStepResult {
    const res: FlightStepResult = { collided: false, respawned: false, pullUp: false, outOfBounds: false };
    const dt = Math.min(fin(dtIn), 0.1);
    if (dt <= 0) return res;
    time += dt;

    let turnIn = unit(controls.turn);
    const pitchIn = unit(controls.pitch);
    const wantBoost = controls.boost === true;

    /* ---- boost reserve */
    if (state.boost >= 0.2) exhausted = false;
    if (!wantBoost) exhausted = false;
    const boosting = wantBoost && !exhausted && state.boost > 0;
    if (boosting) {
      state.boost = Math.max(0, state.boost - FLIGHT.boostDrain * dt);
      lastBoostT = time;
      if (state.boost <= 0) exhausted = true;
    } else if (time - lastBoostT >= FLIGHT.boostDelay) {
      state.boost = Math.min(1, state.boost + FLIGHT.boostRecharge * dt);
    }
    state.boosting = boosting;

    /* ---- boundary: steer back towards the centre */
    const b = world.bounds;
    const m = FLIGHT.boundsMargin;
    const { x: px0, y: py0, z: pz0 } = state.pos;
    if (px0 < b.minX - m || px0 > b.maxX + m || pz0 < b.minZ - m || pz0 > b.maxZ + m) {
      res.outOfBounds = true;
      const want = Math.atan2((b.minX + b.maxX) / 2 - px0, -((b.minZ + b.maxZ) / 2 - pz0));
      turnIn = clamp(wrapPi(want - state.heading) * 2.5, -1, 1);
    }

    /* ---- yaw and bank */
    const yawMax = FLIGHT.yawRateMax * (boosting ? FLIGHT.yawBoostScale : 1);
    yawRate += (turnIn * yawMax - yawRate) * (1 - Math.exp(-dt / FLIGHT.yawTau));
    state.heading = wrap2Pi(state.heading + yawRate * dt);
    const bankTarget = clamp(yawRate * FLIGHT.bankPerYawRate, -FLIGHT.bankMax, FLIGHT.bankMax);
    const bankTau = Math.abs(turnIn) > 0.01 ? 0.12 : FLIGHT.levelTau;
    state.bank += (bankTarget - state.bank) * (1 - Math.exp(-dt / bankTau));

    /* ---- speed */
    const vTarget = boosting ? FLIGHT.vBoost : FLIGHT.vCruise * (1 - 0.18 * Math.sin(state.pitch));
    const vTau = boosting ? 0.6 : state.speed > vTarget ? 1.0 : 1.2;
    state.speed = clamp(state.speed + (vTarget - state.speed) * (1 - Math.exp(-dt / vTau)), FLIGHT.vMin, FLIGHT.vBoost);

    /* ---- ground-proximity assist (look 0.5, 1, 1.5 s ahead) */
    const fx = Math.sin(state.heading);
    const fz = -Math.cos(state.heading);
    const hv = state.speed * Math.cos(state.pitch);
    const vyNow = state.speed * Math.sin(state.pitch) + vyKick;
    let minClear = Infinity;
    for (const t of [0.5, 1, 1.5]) {
      const qx = px0 + fx * hv * t;
      const qz = pz0 + fz * hv * t;
      const qy = py0 + vyNow * t;
      minClear = Math.min(minClear, qy - world.solidAt(qx, qz));
      const c = world.hitCollider(qx, qy, qz, 10);
      if (c) minClear = Math.min(minClear, 0);
    }
    const pullUp = minClear < FLIGHT.assistClearance;
    res.pullUp = pullUp;

    /* ---- pitch */
    let pTarget = pitchIn * FLIGHT.pitchMax;
    if (py0 > FLIGHT.ceilingSoft) {
      const f = clamp((py0 - FLIGHT.ceilingSoft) / (FLIGHT.ceilingHard - FLIGHT.ceilingSoft), 0, 1);
      if (pTarget > 0) pTarget *= 1 - f;
      pTarget = Math.min(pTarget, -f * 10 * DEG);
    } else if (pullUp) {
      const sev = clamp((FLIGHT.assistClearance - minClear) / FLIGHT.assistClearance, 0, 1);
      pTarget = Math.max(pTarget, (12 + 13 * sev) * DEG);
    }
    const pTau = pullUp ? 0.3 : Math.abs(pitchIn) > 0.01 ? 0.25 : FLIGHT.levelTau;
    state.pitch += (pTarget - state.pitch) * (1 - Math.exp(-dt / pTau));

    /* ---- integrate */
    const prev = { x: px0, y: py0, z: pz0, heading: state.heading };
    const cp = Math.cos(state.pitch);
    const vyBase = state.speed * Math.sin(state.pitch);
    const vyTot = vyBase + vyKick;
    vyKick *= Math.exp(-dt / 0.5);
    const fx2 = Math.sin(state.heading);
    const fz2 = -Math.cos(state.heading);
    state.pos.x = px0 + fx2 * state.speed * cp * dt;
    state.pos.z = pz0 + fz2 * state.speed * cp * dt;
    state.pos.y = py0 + vyTot * dt;
    state.vy = vyTot;
    if (state.pos.y > FLIGHT.ceilingHard) {
      state.pos.y = FLIGHT.ceilingHard;
      if (vyKick > 0) vyKick = 0;
      state.pitch = Math.min(state.pitch, 0);
      state.vy = Math.min(state.vy, 0);
    }

    /* ---- collision */
    const hit = probe(world, state.pos.x, state.pos.y, state.pos.z, state.heading, state.bank);
    if (hit) {
      res.collided = true;
      res.hit = hitName(world, hit);
      respond(world, hit, prev, vyTot);
      hitTimes.push(time);
      hitTimes = hitTimes.filter((t) => time - t <= 3);
      if (hitTimes.length >= 3) {
        restoreFromSnapshot();
        hitTimes = [];
        res.respawned = true;
      }
    }

    /* ---- safe snapshots */
    if (time >= nextSnapT) {
      nextSnapT = time + 1;
      const p = state.pos;
      if (
        !res.collided &&
        p.x > b.minX &&
        p.x < b.maxX &&
        p.z > b.minZ &&
        p.z < b.maxZ &&
        p.y - world.solidAt(p.x, p.z) > 40 &&
        !world.hitCollider(p.x, p.y, p.z, 40)
      ) {
        snap = { pos: { ...p }, heading: state.heading };
      }
    }

    /* ---- robustness */
    const s = state;
    if (
      !Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.heading + s.pitch + s.bank + s.speed + s.vy + s.boost)
    ) {
      restoreFromSnapshot();
      state.boost = 1;
    }
    state.speed = clamp(state.speed, FLIGHT.vMin, FLIGHT.vBoost);
    return res;
  }

  function respond(world: WorldQuery, hit: Probe, prev: { x: number; y: number; z: number; heading: number }, vyTot: number) {
    const p = state.pos;
    let wall = false;
    let nx = 0;
    let nz = 0;
    let liftTo = p.y;
    if (hit.kind === 'collider') {
      const c = hit.c;
      const fromAbove = prev.y - FLIGHT.hitRadius >= c.y1 - 0.5;
      if (fromAbove) liftTo = c.y1 + 3;
      else {
        wall = true;
        [nx, nz] = colliderNormal(c, hit.px, hit.pz);
      }
    } else {
      const pch = Math.cos(prev.heading);
      const psh = Math.sin(prev.heading);
      const qx = prev.x + hit.k * FLIGHT.wingHalfSpan * pch;
      const qz = prev.z + hit.k * FLIGHT.wingHalfSpan * psh;
      const prevS = world.solidAt(qx, qz);
      if (hit.s - prevS > 3 && prev.y - FLIGHT.hitRadius < hit.s) {
        wall = true;
        const e = world.solidAt(hit.px + 6, hit.pz) - world.solidAt(hit.px - 6, hit.pz);
        const n = world.solidAt(hit.px, hit.pz + 6) - world.solidAt(hit.px, hit.pz - 6);
        const l = Math.hypot(e, n);
        if (l > 1e-3) {
          nx = -e / l;
          nz = -n / l;
        } else {
          nx = -Math.sin(state.heading);
          nz = Math.cos(state.heading);
        }
      } else {
        // lift clear of the highest of the three probe points
        const ch = Math.cos(state.heading);
        const sh = Math.sin(state.heading);
        const sb = Math.sin(state.bank);
        let need = -Infinity;
        for (const k of [0, 1, -1]) {
          const s = world.solidAt(p.x + k * FLIGHT.wingHalfSpan * ch, p.z + k * FLIGHT.wingHalfSpan * sh);
          need = Math.max(need, s + 3 + k * FLIGHT.wingHalfSpan * sb);
        }
        liftTo = need;
      }
    }
    if (wall) {
      p.x = prev.x;
      p.y = prev.y;
      p.z = prev.z;
      const fx = Math.sin(state.heading);
      const fz = -Math.cos(state.heading);
      const d = fx * nx + fz * nz;
      let rx: number;
      let rz: number;
      if (d < 0) {
        rx = fx - 2 * d * nx;
        rz = fz - 2 * d * nz;
      } else {
        rx = fx + nx;
        rz = fz + nz;
      }
      if (Math.hypot(rx, rz) < 1e-6) {
        rx = nx;
        rz = nz;
      }
      state.heading = wrap2Pi(Math.atan2(rx, -rz));
      yawRate = 0;
      state.speed = Math.max(FLIGHT.vMin, state.speed * 0.5);
      vyKick = Math.max(vyKick, 0) + 8;
    } else {
      p.y = Math.max(p.y, liftTo);
      vyKick = Math.abs(vyTot) * 0.5 + 8;
      state.pitch = Math.max(state.pitch, 15 * DEG);
      state.speed = Math.max(FLIGHT.vMin, state.speed * 0.7);
    }
    state.vy = vyKick + state.speed * Math.sin(state.pitch);
  }

  return { state, reset, step };
}
