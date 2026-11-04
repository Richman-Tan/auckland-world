import type { Proximity, ProximityUpdate, StopPlacement, Vec3 } from '../app/contracts';
import type { StopId } from '../content/types';

export const PROXIMITY = { exitExtra: 60, heightBand: 400 } as const;

/** Enter at triggerRadius, leave at triggerRadius + 60 (hysteresis). Height band: ground to +400 m. */
export function createProximity(stops: StopPlacement[]): Proximity {
  let current: StopPlacement | null = null;

  const inBand = (s: StopPlacement, y: number) =>
    y >= s.groundY - 20 && y <= Math.max(s.groundY, s.baseY) + PROXIMITY.heightBand;

  return {
    update(pos: Vec3): ProximityUpdate {
      const before = current;
      if (current) {
        const d = Math.hypot(pos.x - current.x, pos.z - current.z);
        if (d > current.triggerRadius + PROXIMITY.exitExtra || !inBand(current, pos.y)) current = null;
      }
      if (!current) {
        let best: StopPlacement | null = null;
        let bestD = Infinity;
        for (const s of stops) {
          if (s === before) continue;
          const d = Math.hypot(pos.x - s.x, pos.z - s.z);
          if (d <= s.triggerRadius && inBand(s, pos.y) && d < bestD) {
            best = s;
            bestD = d;
          }
        }
        current = best;
      }
      const id = (s: StopPlacement | null): StopId | null => (s ? s.id : null);
      return {
        current: id(current),
        entered: current && current !== before ? current.id : null,
        exited: before && current !== before ? before.id : null,
      };
    },
  };
}
