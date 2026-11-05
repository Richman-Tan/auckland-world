/**
 * Walking on the Sky Deck. Pure: takes the same turn/pitch controls the plane uses (keys, drag or
 * touch stick) and moves a person around the ring, kept between the core and the windows.
 * Yaw follows the flight heading convention: forward is (sin yaw, -cos yaw), turning right adds.
 */
import { type Hotspot, SKY_DECK, SKY_DECK_SPOTS, apothem, hotspotPoint } from './layout';

export interface Walker {
  x: number;
  z: number;
  yaw: number;
}

export const WALK = {
  speed: 3.2,
  boostSpeed: 5.5,
  turnRate: 1.9,
  /** Keep this far from the windows, and further from the core so its wall never fills the view. */
  margin: 0.45,
  coreMargin: 1.1,
  /** How close, and how squarely facing, a hotspot must be to use it. */
  reach: 4.2,
  facingDeg: 55,
} as const;

const minR = SKY_DECK.coreRadius + WALK.coreMargin;
const maxR = apothem(SKY_DECK.windowRadius) - WALK.margin;

/** Start at the lift, looking along the deck towards the WIE screen and the windows. */
export function spawnWalker(): Walker {
  const lift = SKY_DECK_SPOTS.find((s) => s.kind === 'lift')!;
  const p = hotspotPoint(lift, 2.2);
  const look = { x: Math.cos(1.25) * 12, z: Math.sin(1.25) * 12 };
  return { x: p.x, z: p.z, yaw: Math.atan2(look.x - p.x, -(look.z - p.z)) };
}

export function stepWalker(w: Walker, c: { turn: number; pitch: number; boost?: boolean }, dt: number): Walker {
  const yaw = w.yaw + c.turn * WALK.turnRate * dt;
  // Pitch is "nose up" positive, so pushing forward (W, stick up, drag up) is negative pitch.
  const speed = (c.boost ? WALK.boostSpeed : WALK.speed) * -c.pitch;
  let x = w.x + Math.sin(yaw) * speed * dt;
  let z = w.z - Math.cos(yaw) * speed * dt;
  const r = Math.hypot(x, z);
  if (r < minR || r > maxR) {
    const k = Math.min(Math.max(r, minR), maxR) / (r || 1);
    x *= k;
    z *= k;
  }
  return { x, z, yaw };
}

/** The hotspot the walker is close to and facing, if any (nearest first). */
export function hotspotAt(w: Walker, spots: readonly Hotspot[] = SKY_DECK_SPOTS): Hotspot | null {
  let best: Hotspot | null = null;
  let bestD = Infinity;
  const fx = Math.sin(w.yaw);
  const fz = -Math.cos(w.yaw);
  const cosMax = Math.cos((WALK.facingDeg * Math.PI) / 180);
  for (const s of spots) {
    const p = hotspotPoint(s);
    const dx = p.x - w.x;
    const dz = p.z - w.z;
    const d = Math.hypot(dx, dz);
    if (d > WALK.reach || d < 1e-6) continue;
    if ((dx * fx + dz * fz) / d < cosMax) continue;
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
