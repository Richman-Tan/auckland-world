/**
 * How the plane's control surfaces sit, and where its shadow is cast from. Pure, so both can be tested.
 */

export interface Attitude {
  heading: number;
  pitch: number;
  bank: number;
}

export interface Deflections {
  /** Positive rolls right: right aileron up, left aileron down. */
  aileron: number;
  /** Positive pitches up: elevator trailing edge up. */
  elevator: number;
  /** Positive yaws right: rudder trailing edge to the right. */
  rudder: number;
}

/** The furthest each surface swings, radians. */
export const MAX_DEFLECTION = { aileron: 0.42, elevator: 0.34, rudder: 0.32 } as const;
/** Radians of deflection per radian a second of roll, pitch and turn. */
const GAIN = { aileron: 0.55, elevator: 1.3, rudder: 0.7 } as const;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v));

/**
 * Where the surfaces would be to produce the change in attitude from `prev` to `cur` over `dt`
 * seconds: the plane is flown by its flight model, and the surfaces follow what it did. Rates are
 * clamped, so an autopilot time-warp (many steps in one frame) just holds them at full travel.
 */
export function surfaceDeflections(prev: Attitude, cur: Attitude, dt: number): Deflections {
  if (!(dt > 0)) return { aileron: 0, elevator: 0, rudder: 0 };
  return {
    aileron: clamp((wrap(cur.bank - prev.bank) / dt) * GAIN.aileron, MAX_DEFLECTION.aileron),
    elevator: clamp((wrap(cur.pitch - prev.pitch) / dt) * GAIN.elevator, MAX_DEFLECTION.elevator),
    rudder: clamp((wrap(cur.heading - prev.heading) / dt) * GAIN.rudder, MAX_DEFLECTION.rudder),
  };
}

/**
 * The direction the plane's shadow is cast from (a unit vector towards the light). It is the sun's
 * or moon's own bearing, but never lower than `minElevationDeg`: at dusk the true shadow would land
 * hundreds of metres away, and the shadow is there to show how high the plane is, which it only
 * does while it stays more or less underneath.
 */
export function shadowDirection(light: readonly [number, number, number], minElevationDeg: number): [number, number, number] {
  const [x, y, z] = light;
  const flat = Math.hypot(x, z);
  const min = (minElevationDeg * Math.PI) / 180;
  const elevation = Math.max(min, Math.atan2(y, flat));
  if (flat < 1e-6) return [0, 1, 0];
  const c = Math.cos(elevation);
  return [(x / flat) * c, Math.sin(elevation), (z / flat) * c];
}
