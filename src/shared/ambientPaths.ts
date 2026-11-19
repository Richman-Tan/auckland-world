/**
 * Where the city's ambient traffic goes: ferry routes on the harbour and the lanes of the Harbour
 * Bridge. Pure geometry (no three.js), shared by the runtime (world/ambient.ts) and the tests.
 *
 * Ferry routes are written as real lat/lon waypoints. A route is only used if every point along it
 * is over open water on the loaded map, which is what keeps the synthetic test map (where these
 * coordinates mean nothing) free of boats sailing across fields.
 */
import { HARBOUR_BRIDGE, type WorldQuery, bridgeProfileAt } from './collision';
import { type GeoFit, type MapMeta, latLonToLocal } from './mapFormat';

export interface XZ {
  x: number;
  z: number;
}

export interface FerryRoute {
  name: string;
  /** Waypoints in order, [lat, lon]. The boat shuttles to the end and back. */
  points: readonly (readonly [number, number])[];
  /** How many boats share the route, spaced evenly round the loop. */
  boats: number;
  /** Metres per second. */
  speed: number;
}

/** A wharf pause at each end of a route, seconds. */
export const FERRY_DWELL_S = 12;

export const FERRY_ROUTES: readonly FerryRoute[] = [
  {
    // The Devonport ferry: out of the downtown basin between the wharves, then east across the harbour.
    name: 'Downtown to Devonport',
    points: [
      [-36.8392, 174.768],
      [-36.8368, 174.77],
      [-36.835, 174.778],
      [-36.8342, 174.788],
      [-36.8338, 174.7925],
    ],
    boats: 2,
    speed: 11,
  },
  {
    // North across the harbour mouth of Shoal Bay towards Bayswater.
    name: 'Downtown to Bayswater',
    points: [
      [-36.8372, 174.7655],
      [-36.8318, 174.7672],
      [-36.8262, 174.7712],
    ],
    boats: 1,
    speed: 10,
  },
];

/** A polyline with the running distance to each vertex. */
export interface Path {
  points: XZ[];
  /** dist[i] is the distance along the path to points[i]; the last entry is the total length. */
  dist: number[];
  length: number;
}

export function makePath(points: readonly XZ[]): Path {
  const dist = [0];
  for (let i = 1; i < points.length; i++) dist.push(dist[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  return { points: [...points], dist, length: dist[dist.length - 1] };
}

/** Position and heading (radians, 0 = north, clockwise) at a distance along a path, clamped to its ends. */
export function pathAt(path: Path, s: number): { x: number; z: number; heading: number } {
  const d = Math.min(Math.max(s, 0), path.length);
  let i = 0;
  while (i < path.points.length - 2 && path.dist[i + 1] < d) i++;
  const a = path.points[i];
  const b = path.points[i + 1];
  const seg = path.dist[i + 1] - path.dist[i];
  const t = seg > 0 ? (d - path.dist[i]) / seg : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.x - a.x, -(b.z - a.z)) };
}

/**
 * Where a shuttling boat is at time `t` (seconds): out along the path, a pause, back, a pause.
 * `phase` (0..1) offsets boats sharing a route. Heading follows the direction of travel.
 */
export function shuttleAt(path: Path, speed: number, t: number, phase = 0): { x: number; z: number; heading: number } {
  const leg = path.length / speed;
  const cycle = 2 * (leg + FERRY_DWELL_S);
  let u = (((t / cycle + phase) % 1) + 1) % 1;
  u *= cycle;
  if (u < leg) return pathAt(path, u * speed);
  if (u < leg + FERRY_DWELL_S) return pathAt(path, path.length);
  if (u < 2 * leg + FERRY_DWELL_S) {
    const p = pathAt(path, path.length - (u - leg - FERRY_DWELL_S) * speed);
    return { ...p, heading: p.heading + Math.PI };
  }
  const p = pathAt(path, 0);
  return { ...p, heading: p.heading + Math.PI };
}

/** A route's waypoints in the map's local metres. */
export function routePath(geo: GeoFit, route: FerryRoute): Path {
  return makePath(route.points.map(([lat, lon]) => latLonToLocal(geo, lat, lon)));
}

/**
 * True when the whole path, and a boat's width either side of it, is over open water inside the map.
 * Checked every `step` metres.
 */
export function pathOverWater(path: Path, query: WorldQuery, meta: Pick<MapMeta, 'bounds' | 'water'>, clearance = 14, step = 12): boolean {
  if (path.length < step) return false;
  const b = meta.bounds;
  for (let s = 0; s <= path.length; s += step) {
    const p = pathAt(path, s);
    const rx = Math.cos(p.heading);
    const rz = Math.sin(p.heading);
    for (const side of [-clearance, 0, clearance]) {
      const x = p.x + rx * side;
      const z = p.z + rz * side;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
      if (query.solidAt(x, z) > meta.water.level + 0.5) return false;
    }
  }
  return true;
}

/**
 * A slow boat that passes under the Harbour Bridge's main span and back. Defined from the bridge
 * itself (not lat/lon), so it always threads the gap between the two tallest piers.
 */
export function bridgeCruisePath(hb: MapMeta['landmarks']['harbourBridge'], reach = 650): Path {
  const g = bridgeGeometry(hb);
  // The navigation span lies between the piers at 0.48 and 0.72 of the way along.
  const mid = (HARBOUR_BRIDGE.pierFractions[4] + HARBOUR_BRIDGE.pierFractions[5]) / 2;
  const a = g.at(mid * g.length, -reach);
  const b = g.at(mid * g.length, reach);
  return makePath([
    { x: a.x, z: a.z },
    { x: b.x, z: b.z },
  ]);
}

export const BRIDGE_CRUISE: Omit<FerryRoute, 'points'> = { name: 'Under the Harbour Bridge', boats: 1, speed: 8 };

/** The boat routes that are usable on this map: every one of them wholly over water. */
export function ferryPaths(meta: MapMeta, query: WorldQuery): { route: Omit<FerryRoute, 'points'>; path: Path }[] {
  const out: { route: Omit<FerryRoute, 'points'>; path: Path }[] = [];
  for (const route of FERRY_ROUTES) {
    const path = routePath(meta.geo, route);
    if (pathOverWater(path, query, meta)) out.push({ route, path });
  }
  const cruise = bridgeCruisePath(meta.landmarks.harbourBridge);
  if (pathOverWater(cruise, query, meta)) out.push({ route: BRIDGE_CRUISE, path: cruise });
  return out;
}

/* ------------------------------------------------------------ bridge traffic */

/** Lane centres across the deck, metres from the centreline, inside the truss. */
export const BRIDGE_LANES = [3.5, 7.2] as const;
/** Cars drive on the left. */
export const BRIDGE_CAR_SPEED = 22;

export interface BridgeGeometry {
  length: number;
  /** Position on the road surface at distance s from end a, `lateral` metres to the side. */
  at(s: number, lateral: number): { x: number; y: number; z: number };
  /** Heading (radians, 0 = north, clockwise) when driving from a to b. */
  heading: number;
}

export function bridgeGeometry(hb: MapMeta['landmarks']['harbourBridge']): BridgeGeometry {
  const dx = hb.b.x - hb.a.x;
  const dz = hb.b.z - hb.a.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  // Same lateral axis as the bridge model (world/landmarks/harbourBridge.ts).
  const vx = -uz;
  const vz = ux;
  return {
    length,
    heading: Math.atan2(ux, -uz),
    at(s, lateral) {
      return { x: hb.a.x + ux * s + vx * lateral, y: bridgeProfileAt(hb.deckY, hb.step, s), z: hb.a.z + uz * s + vz * lateral };
    },
  };
}

/**
 * Car `i` of `count` at time `t`: which way it is going, where along the bridge, and in which lane.
 * Cars heading a to b keep to the left of the centreline (the -lateral side), the others to +lateral.
 * Spacing is uneven on purpose, so the traffic does not march in step.
 */
export function bridgeCar(i: number, count: number, length: number, t: number): { s: number; lateral: number; forward: boolean } {
  const forward = i % 2 === 0;
  const lane = BRIDGE_LANES[(i >> 1) % BRIDGE_LANES.length];
  // A fixed pseudo-random offset per car, and a few per cent of speed difference between them.
  const jitter = ((i * 0.6180339887) % 1) * 0.6;
  const speed = BRIDGE_CAR_SPEED * (0.9 + 0.2 * ((i * 0.7548776662) % 1));
  const start = ((i + jitter) / count) * length;
  const along = (((start + t * speed) % length) + length) % length;
  return { s: forward ? along : length - along, lateral: forward ? -lane : lane, forward };
}

/** The deck must be wide enough for the lanes used (a guard for maps with a different bridge). */
export const BRIDGE_LANES_FIT = Math.max(...BRIDGE_LANES) + 1.5 < HARBOUR_BRIDGE.trussHalfWidth;
