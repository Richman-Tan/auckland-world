/**
 * What the plane can hit. Pure (no DOM, no three) so the geometry worker, the runtime and the
 * Node tests (headless autopilot runs on the real grid) all use exactly the same world.
 *
 * Two parts:
 *  - a height grid (default 6 m cells) = max(water level, terrain, building tops), built from the
 *    shipped terrain and building footprints, so what you see and what you hit never drift apart;
 *  - analytic colliders for the hand-modelled landmarks (Sky Tower, Harbour Bridge), whose
 *    dimensions are fixed here and must be matched by the visual models in src/world/landmarks.
 */
import { HARBOUR_BRIDGE, bridgeModel } from './bridge';
import { CONTAINER, STACK_SIZE, containerStacks, excludedBuildings, siteColliders, yardAxis } from './landmarkSites';
import { PLANT_ROOM, buildingSeed, plantRoom } from './roofs';
import {
  type Bounds,
  type BuildingsData,
  type MapMeta,
  type TerrainGrid,
  sampleTerrain,
} from './mapFormat';

export interface CollisionGrid {
  cols: number;
  rows: number;
  cell: number;
  x0: number;
  z0: number;
  /** Solid height per cell in decimetres ASL, row-major north -> south. */
  data: Int16Array;
  /**
   * The container stacks in the port's yard, which are in the grid like buildings and are handed
   * on here so that what is drawn is exactly what was made solid (landmarkSites.ts, STACK_SIZE
   * numbers a stack, then its base height appended: x, z, levels, colour, base).
   */
  containers?: Float32Array;
}

/** Numbers per stack in CollisionGrid.containers. */
export const GRID_STACK_SIZE = STACK_SIZE + 1;

export type Collider =
  | { kind: 'cylinder'; name: string; x: number; z: number; y0: number; y1: number; r: number }
  /** Oriented box: centre (cx, cz), unit axis (ux, uz) in the xz plane, half-extents hu along it and hv across it. */
  | {
      kind: 'box';
      name: string;
      cx: number;
      cz: number;
      ux: number;
      uz: number;
      hu: number;
      hv: number;
      y0: number;
      y1: number;
    };

export interface WorldQuery {
  bounds: Bounds;
  waterLevel: number;
  /** Visible surface height: terrain, or the water level where terrain is below it. */
  groundAt(x: number, z: number): number;
  /** Top of whatever is solid in this 6 m cell (ground, water, buildings). Excludes analytic colliders. */
  solidAt(x: number, z: number): number;
  colliders: readonly Collider[];
  /** First analytic collider a sphere at (x, y, z) with this radius touches, or null. */
  hitCollider(x: number, y: number, z: number, radius: number): Collider | null;
}

/* ----------------------------------------------------------- landmark sizes */

/** Sky Tower dimensions in metres above its ground. The visual model must match these. */
export const SKY_TOWER = {
  height: 328,
  legsTop: 40,
  legsRadius: 16,
  shaftRadius: 6,
  shaftTop: 186,
  podBottom: 182,
  podTop: 226,
  podRadius: 20,
  upperShaftRadius: 4,
  upperShaftTop: 260,
  mastRadius: 2,
} as const;

// The Harbour Bridge's dimensions and profile live in ./bridge (re-exported here for existing callers).
export { HARBOUR_BRIDGE, bridgeProfileAt } from './bridge';

export function landmarkColliders(meta: MapMeta): Collider[] {
  const out: Collider[] = [];
  const st = meta.landmarks.skyTower;
  const g = st.groundY;
  out.push({ kind: 'cylinder', name: 'Sky Tower legs', x: st.x, z: st.z, y0: g - 5, y1: g + SKY_TOWER.legsTop, r: SKY_TOWER.legsRadius });
  out.push({ kind: 'cylinder', name: 'Sky Tower shaft', x: st.x, z: st.z, y0: g, y1: g + SKY_TOWER.shaftTop, r: SKY_TOWER.shaftRadius });
  out.push({ kind: 'cylinder', name: 'Sky Tower pod', x: st.x, z: st.z, y0: g + SKY_TOWER.podBottom, y1: g + SKY_TOWER.podTop, r: SKY_TOWER.podRadius });
  out.push({ kind: 'cylinder', name: 'Sky Tower upper shaft', x: st.x, z: st.z, y0: g + SKY_TOWER.podTop, y1: g + SKY_TOWER.upperShaftTop, r: SKY_TOWER.upperShaftRadius });
  out.push({ kind: 'cylinder', name: 'Sky Tower mast', x: st.x, z: st.z, y0: g + SKY_TOWER.upperShaftTop, y1: g + SKY_TOWER.height, r: SKY_TOWER.mastRadius });

  // The bridge, from the one description the model and the traffic also use (./bridge).
  const hb = meta.landmarks.harbourBridge;
  const m = bridgeModel(hb);
  if (m.length > 1 && m.stations > 1) {
    const { ux, uz } = m;
    for (let i = m.span.first; i < m.span.last; i++) {
      const s0 = i * m.step;
      const s1 = Math.min((i + 1) * m.step, m.length);
      if (s1 <= s0) break;
      const sm = (s0 + s1) / 2;
      const deck = m.deckAt(sm);
      const { x: cx, z: cz } = m.at(sm, 0);
      const hu = (s1 - s0) / 2 + 0.5;
      // The road and everything hung under it: the truss, or the viaduct's girders.
      const under = Math.min(m.bottomAt(s0), m.bottomAt(sm), m.bottomAt(s1));
      out.push({ kind: 'box', name: 'Harbour Bridge deck', cx, cz, ux, uz, hu, hv: HARBOUR_BRIDGE.deckHalfWidth, y0: under, y1: deck + 1.2 });
      // The truss is one run of stations; a segment has it if both its ends do.
      if (m.isTruss(i) && m.isTruss(i + 1)) {
        out.push({ kind: 'box', name: 'Harbour Bridge truss', cx, cz, ux, uz, hu, hv: HARBOUR_BRIDGE.trussHalfWidth, y0: deck + 1, y1: Math.max(m.topY[i], m.topY[i + 1]) });
      }
    }
    for (const pier of m.piers) {
      const { x: cx, z: cz } = m.at(pier.s, 0);
      // Two legs from the sea bed, and the beam across their tops that the truss and the clip-ons sit on.
      const top = m.bottomAt(pier.s);
      const cap = top - HARBOUR_BRIDGE.pierCapHeight;
      out.push({ kind: 'box', name: 'Harbour Bridge pier', cx, cz, ux, uz, hu: HARBOUR_BRIDGE.pierHalfLength, hv: HARBOUR_BRIDGE.pierHalfWidth, y0: -10, y1: cap });
      out.push({ kind: 'box', name: 'Harbour Bridge pier cap', cx, cz, ux, uz, hu: HARBOUR_BRIDGE.pierCapHalfLength, hv: HARBOUR_BRIDGE.deckHalfWidth, y0: cap, y1: top + 0.5 });
    }
    for (const s of m.bents) {
      const { x: cx, z: cz } = m.at(s, 0);
      out.push({ kind: 'box', name: 'Harbour Bridge columns', cx, cz, ux, uz, hu: HARBOUR_BRIDGE.bentHalfLength, hv: HARBOUR_BRIDGE.bentHalfWidth, y0: m.groundAt(s) - 3, y1: m.bottomAt(s) + 0.5 });
    }
  }
  // The museum, Eden Park, the silos, the footbridge and the port's cranes, where the map has them.
  out.push(...siteColliders(meta.landmarks));
  return out;
}

/* ------------------------------------------------------------ collision grid */

function pointInRing(xz: ArrayLike<number>, start: number, end: number, px: number, pz: number): boolean {
  let inside = false;
  const n = (end - start) / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = xz[start + i * 2];
    const zi = xz[start + i * 2 + 1];
    const xj = xz[start + j * 2];
    const zj = xz[start + j * 2 + 1];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Build the solid-height grid. A cell takes a building's top if the building's outer ring contains
 * the cell centre or any of four points 1.5 m from it (holes are ignored: courtyards count as solid).
 *
 * With `landmarks`, the plain buildings that a modelled landmark replaces are left out (their
 * colliders are landmarkColliders'), and the port's container stacks are put in.
 */
export function buildCollisionGrid(
  terrain: TerrainGrid,
  buildings: BuildingsData,
  bounds: Bounds,
  cell = 6,
  waterLevel = 0,
  landmarks?: MapMeta['landmarks'],
): CollisionGrid {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const x0 = bounds.minX;
  const z0 = bounds.minZ;
  const data = new Int16Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const z = z0 + (r + 0.5) * cell;
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * cell;
      const h = Math.max(waterLevel, sampleTerrain(terrain, x, z));
      data[r * cols + c] = Math.round(h * 10);
    }
  }
  const offs = [0, 0, 1.5, 0, -1.5, 0, 0, 1.5, 0, -1.5];
  const xz = buildings.xz;
  const left = excludedBuildings(buildings, landmarks);
  for (let b = 0; b < buildings.count; b++) {
    if (left[b]) continue;
    const ring = buildings.buildingRingStart[b];
    const vs = buildings.ringVertexStart[ring] * 2;
    const ve = buildings.ringVertexStart[ring + 1] * 2;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = vs; i < ve; i += 2) {
      const x = xz[i];
      const z = xz[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    // A tower's plant room is part of what can be hit: the whole building counts as that much taller.
    const height = buildings.topY[b] - buildings.baseY[b];
    const single = buildings.buildingRingStart[b + 1] - ring === 1;
    const room = single && height >= PLANT_ROOM.minHeight ? plantRoom(xz.subarray(vs, ve), height, buildingSeed(xz[vs], xz[vs + 1])) : null;
    const top = Math.round((buildings.topY[b] + (room ? room.height : 0)) * 10);
    const c0 = Math.max(0, Math.floor((minX - 1.5 - x0) / cell));
    const c1 = Math.min(cols - 1, Math.floor((maxX + 1.5 - x0) / cell));
    const r0 = Math.max(0, Math.floor((minZ - 1.5 - z0) / cell));
    const r1 = Math.min(rows - 1, Math.floor((maxZ + 1.5 - z0) / cell));
    for (let r = r0; r <= r1; r++) {
      const cz = z0 + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const idx = r * cols + c;
        if (data[idx] >= top) continue;
        const cx = x0 + (c + 0.5) * cell;
        for (let k = 0; k < offs.length; k += 2) {
          if (pointInRing(xz, vs, ve, cx + offs[k], cz + offs[k + 1])) {
            data[idx] = top;
            break;
          }
        }
      }
    }
  }
  const grid: CollisionGrid = { cols, rows, cell, x0, z0, data };
  const port = landmarks?.port;
  if (port) {
    const groundAt = (x: number, z: number) => Math.max(waterLevel, sampleTerrain(terrain, x, z));
    const at = (x: number, z: number) => {
      const c = Math.floor((x - x0) / cell);
      const r = Math.floor((z - z0) / cell);
      return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
    };
    // Open ground: dry land with nothing built on it.
    const free = (x: number, z: number) => {
      const i = at(x, z);
      const g = groundAt(x, z);
      return i >= 0 && g > waterLevel + 0.3 && data[i] / 10 <= g + 0.6;
    };
    const stacks = containerStacks(port, free);
    const { ux, uz } = yardAxis(port.ring);
    const n = stacks.length / STACK_SIZE;
    const withBase = new Float32Array(n * GRID_STACK_SIZE);
    const reach = Math.hypot(CONTAINER.length, CONTAINER.width) / 2 + cell;
    for (let s = 0; s < n; s++) {
      const x = stacks[s * STACK_SIZE];
      const z = stacks[s * STACK_SIZE + 1];
      const base = groundAt(x, z);
      const top = Math.round((base + stacks[s * STACK_SIZE + 2] * CONTAINER.height) * 10);
      withBase.set(stacks.subarray(s * STACK_SIZE, (s + 1) * STACK_SIZE), s * GRID_STACK_SIZE);
      withBase[s * GRID_STACK_SIZE + STACK_SIZE] = base;
      for (let cz = z - reach; cz <= z + reach; cz += cell) {
        for (let cx = x - reach; cx <= x + reach; cx += cell) {
          const i = at(cx, cz);
          if (i < 0) continue;
          // The cell's own centre, against the stack's rectangle grown by the same margin buildings get.
          const px = x0 + (Math.floor((cx - x0) / cell) + 0.5) * cell - x;
          const pz = z0 + (Math.floor((cz - z0) / cell) + 0.5) * cell - z;
          if (Math.abs(px * ux + pz * uz) <= CONTAINER.length / 2 + 1.5 && Math.abs(-px * uz + pz * ux) <= CONTAINER.width / 2 + 1.5 && data[i] < top) data[i] = top;
        }
      }
    }
    grid.containers = withBase;
  }
  return grid;
}

function hitsCollider(c: Collider, x: number, y: number, z: number, radius: number): boolean {
  if (y + radius < c.y0 || y - radius > c.y1) return false;
  if (c.kind === 'cylinder') {
    return Math.hypot(x - c.x, z - c.z) < c.r + radius;
  }
  const dx = x - c.cx;
  const dz = z - c.cz;
  const u = dx * c.ux + dz * c.uz;
  const v = -dx * c.uz + dz * c.ux;
  return Math.abs(u) < c.hu + radius && Math.abs(v) < c.hv + radius;
}

export function createWorldQuery(
  terrain: TerrainGrid,
  grid: CollisionGrid,
  colliders: Collider[],
  bounds: Bounds,
  waterLevel = 0,
): WorldQuery {
  return {
    bounds,
    waterLevel,
    colliders,
    groundAt(x, z) {
      return Math.max(waterLevel, sampleTerrain(terrain, x, z));
    },
    solidAt(x, z) {
      const c = Math.floor((x - grid.x0) / grid.cell);
      const r = Math.floor((z - grid.z0) / grid.cell);
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) {
        return Math.max(waterLevel, sampleTerrain(terrain, x, z));
      }
      return grid.data[r * grid.cols + c] / 10;
    },
    hitCollider(x, y, z, radius) {
      for (const c of colliders) if (hitsCollider(c, x, y, z, radius)) return c;
      return null;
    },
  };
}
