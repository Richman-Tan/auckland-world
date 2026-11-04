import type { Controls, FlightState, OrbitController, StopPlacement, WorldQuery } from '../app/contracts';
import { createTerrainGuard, nearbyColliders, orbitControls } from './guidance';
import type { TerrainGuard } from './guidance';

/** Holding orbit: constant-bank circle at stop.orbitRadius / orbitY, clockwise. */
export function createOrbit(stop: StopPlacement): OrbitController {
  let guard: TerrainGuard | null = null;
  return {
    update(state: FlightState, world: WorldQuery): Controls {
      guard ??= createTerrainGuard(
        nearbyColliders(world, [[stop.x, stop.z, stop.x, stop.z]], stop.orbitRadius + 600),
      );
      const needed = guard.pitchNeeded(state, world, 0.3);
      return orbitControls(state, stop.x, stop.z, stop.orbitRadius, stop.orbitY, needed);
    },
  };
}
