/**
 * Roads as ribbons lying on the terrain. Pure geometry (no three, no DOM), so it runs in the worker
 * and in tests.
 *
 * Each road becomes a strip two vertices wide. Every vertex carries where it is across the road and
 * how far along, and the road's class, lanes and footpath; the ribbon material paints kerbs, lines
 * and dashes from those, so the mesh itself stays as simple as a strip can be.
 *
 * The triangles are grouped by the map tile their segment falls in. Only the tiles near the camera
 * are ever drawn (see nearSet.ts), so the whole network costs a few thousand triangles a frame.
 */
import { bridgeModel } from '../shared/bridge';
import type { Bounds, MapMeta, RoadsData } from '../shared/mapFormat';
import { LANE_WIDTH, RAIL, ROAD_CLASSES, ROAD_ONEWAY, carriagewayHalfWidth, footpathWidth, lanesOf } from '../shared/roads';

export interface RibbonMesh {
  positions: Float32Array;
  /** Signed metres from the centre line. */
  across: Float32Array;
  /** Metres from the start of the way. */
  along: Float32Array;
  /** Half the sealed width, kerb to kerb. */
  half: Float32Array;
  /** Four bytes a vertex: class, lanes, flags (INFO_*), footpath width in decimetres. */
  info: Uint8Array;
  /** Triangles, grouped by tile: tile t owns indices [tileStart[t], tileStart[t + 1]). */
  indices: Uint32Array;
  tileStart: Uint32Array;
  tiles: TileGrid;
}

export interface TileGrid {
  x0: number;
  z0: number;
  size: number;
  nx: number;
  nz: number;
}

/** Bits of the third info byte. */
export const INFO_ONEWAY = 1;
/** Line markings are painted here (off close to a way's ends, where it meets other roads). */
export const INFO_MARKED = 2;

/**
 * A strip given outright instead of being laid on the ground: the lanes on a bridge deck. Each
 * station is the middle of the strip, its height, the unit vector across it (towards positive
 * `across`) and how far along it is.
 */
export interface Strip {
  cls: number;
  lanes: number;
  oneway: boolean;
  /** Half the sealed width. */
  half: number;
  stations: { x: number; y: number; z: number; nx: number; nz: number; along: number }[];
}

/** The painted deck sits this far above the bridge's road slab. */
export const BRIDGE_STRIP_LIFT = 0.2;
/** Where the middle of each clip-on's two lanes runs, metres from the bridge's centreline. */
export const BRIDGE_CLIP_ON_CENTRE = 13.5;

/**
 * The Harbour Bridge's eight lanes as three strips on its deck: the four original lanes between
 * the trusses, two-way, and the two lanes of each clip-on outside them. The lane centres these
 * give are BRIDGE_LANES in shared/ambientPaths.ts, which is where the traffic drives.
 */
export function bridgeStrips(hb: MapMeta['landmarks']['harbourBridge']): Strip[] {
  const m = bridgeModel(hb);
  if (m.stations < 2 || m.span.last <= m.span.first) return [];
  const motorway = ROAD_CLASSES.indexOf('motorway');
  const strip = (lateral: number, lanes: number, oneway: boolean, half: number): Strip => {
    const stations: Strip['stations'] = [];
    for (let i = m.span.first; i <= m.span.last; i++) {
      const s = Math.min(i * m.step, m.length);
      const p = m.at(s, lateral);
      stations.push({ x: p.x, y: p.y + BRIDGE_STRIP_LIFT, z: p.z, nx: m.vx, nz: m.vz, along: s - m.span.first * m.step });
    }
    return { cls: motorway, lanes, oneway, half, stations };
  };
  return [
    strip(0, 4, false, 2 * LANE_WIDTH + 0.5),
    strip(-BRIDGE_CLIP_ON_CENTRE, 2, true, LANE_WIDTH + 0.2),
    strip(BRIDGE_CLIP_ON_CENTRE, 2, true, LANE_WIDTH + 0.2),
  ];
}

export interface RibbonOptions {
  /** Strips to add as they are, after the roads. */
  strips?: readonly Strip[];
  /** Longest stretch between two stations, metres: short enough to follow the ground. */
  maxStep?: number;
  tileSize?: number;
  /** Classes below this are left out (the low tier drops service lanes). */
  minClass?: number;
  /** No markings within this distance of a way's end. */
  junction?: number;
}

/**
 * How far above the ground a road sits. Bigger roads sit a few centimetres higher, so where two
 * cross, the bigger one wins by depth whatever order they are drawn in.
 */
export function ribbonLift(cls: number): number {
  if (cls === RAIL) return 0.2;
  if (cls <= 1) return 0.14;
  if (cls <= 5) return 0.22;
  if (cls <= 9) return 0.3;
  return 0.38;
}

export function tileGrid(bounds: Bounds, size: number): TileGrid {
  return { x0: bounds.minX, z0: bounds.minZ, size, nx: Math.ceil((bounds.maxX - bounds.minX) / size), nz: Math.ceil((bounds.maxZ - bounds.minZ) / size) };
}

export function tileOf(g: TileGrid, x: number, z: number): number {
  const i = Math.min(g.nx - 1, Math.max(0, Math.floor((x - g.x0) / g.size)));
  const j = Math.min(g.nz - 1, Math.max(0, Math.floor((z - g.z0) / g.size)));
  return j * g.nx + i;
}

export function buildRibbons(roads: RoadsData, heightAt: (x: number, z: number) => number, bounds: Bounds, opts: RibbonOptions = {}): RibbonMesh {
  const maxStep = opts.maxStep ?? 12;
  const junction = opts.junction ?? 7;
  const minClass = opts.minClass ?? 0;
  const tiles = tileGrid(bounds, opts.tileSize ?? 500);

  const pos: number[] = [];
  const across: number[] = [];
  const along: number[] = [];
  const half: number[] = [];
  const info: number[] = [];
  const perTile: number[][] = Array.from({ length: tiles.nx * tiles.nz }, () => []);

  // One way's stations, reused: x, z, distance along, and whether it is one of the way's own vertices.
  const sx: number[] = [];
  const sz: number[] = [];
  const sd: number[] = [];

  for (let w = 0; w < roads.count; w++) {
    const cls = roads.cls[w];
    if (cls < minClass && cls !== RAIL) continue;
    const flags = roads.flags[w];
    const first = roads.wayStart[w];
    const last = roads.wayStart[w + 1] - 1;
    if (last <= first) continue;

    // Stations: the way's vertices, with extra ones so no stretch is longer than maxStep.
    sx.length = sz.length = sd.length = 0;
    let d = 0;
    for (let v = first; v <= last; v++) {
      const x = roads.xz[v * 2];
      const z = roads.xz[v * 2 + 1];
      if (v > first) {
        const px = roads.xz[v * 2 - 2];
        const pz = roads.xz[v * 2 - 1];
        const len = Math.hypot(x - px, z - pz);
        if (len < 1e-3) continue;
        const parts = Math.ceil(len / maxStep);
        for (let k = 1; k < parts; k++) {
          sx.push(px + ((x - px) * k) / parts);
          sz.push(pz + ((z - pz) * k) / parts);
          sd.push(d + (len * k) / parts);
        }
        d += len;
      }
      sx.push(x);
      sz.push(z);
      sd.push(d);
    }
    const n = sx.length;
    if (n < 2) continue;
    const total = d;

    const halfSeal = carriagewayHalfWidth(cls, flags);
    const path = footpathWidth(cls);
    const edge = halfSeal + path;
    const lift = ribbonLift(cls);
    const lanes = lanesOf(cls, flags);
    const base = pos.length / 3;

    for (let k = 0; k < n; k++) {
      // Direction: the average of the stretch before and the stretch after, so corners are mitred.
      let ax = 0;
      let az = 0;
      if (k > 0) {
        const l = Math.hypot(sx[k] - sx[k - 1], sz[k] - sz[k - 1]);
        ax += (sx[k] - sx[k - 1]) / l;
        az += (sz[k] - sz[k - 1]) / l;
      }
      let bx = 0;
      let bz = 0;
      if (k < n - 1) {
        const l = Math.hypot(sx[k + 1] - sx[k], sz[k + 1] - sz[k]);
        bx = (sx[k + 1] - sx[k]) / l;
        bz = (sz[k + 1] - sz[k]) / l;
      }
      let dx = ax + bx;
      let dz = az + bz;
      let dl = Math.hypot(dx, dz);
      if (dl < 1e-6) {
        // A hairpin back on itself: just use the way out.
        dx = bx || ax;
        dz = bz || az;
        dl = Math.hypot(dx, dz) || 1;
      }
      dx /= dl;
      dz /= dl;
      // At a corner the ribbon is widened so its edges stay parallel to the road, up to twice.
      const cos = k > 0 && k < n - 1 ? Math.max(0.5, Math.abs(dx * bx + dz * bz)) : 1;
      const reach = edge / cos;
      // Across is perpendicular to the direction of travel; the positive side is the right-hand one.
      const nx = -dz;
      const nz = dx;
      const marked = sd[k] > junction && total - sd[k] > junction ? INFO_MARKED : 0;
      for (const side of [-1, 1]) {
        const x = sx[k] + nx * reach * side;
        const z = sz[k] + nz * reach * side;
        pos.push(x, heightAt(x, z) + lift, z);
        across.push(edge * side);
        along.push(sd[k]);
        half.push(halfSeal);
        info.push(cls, lanes, (flags & ROAD_ONEWAY ? INFO_ONEWAY : 0) | marked, Math.round(path * 10));
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const l0 = base + k * 2;
      const r0 = l0 + 1;
      const l1 = l0 + 2;
      const r1 = l0 + 3;
      const t = perTile[tileOf(tiles, (sx[k] + sx[k + 1]) / 2, (sz[k] + sz[k + 1]) / 2)];
      // Wound to face up (the left vertex is the one at negative across).
      t.push(l0, r0, l1, r0, r1, l1);
    }
  }

  for (const strip of opts.strips ?? []) {
    const n = strip.stations.length;
    if (n < 2) continue;
    const base = pos.length / 3;
    const total = strip.stations[n - 1].along;
    for (const st of strip.stations) {
      const marked = st.along > junction && total - st.along > junction ? INFO_MARKED : 0;
      for (const side of [-1, 1]) {
        pos.push(st.x + st.nx * strip.half * side, st.y, st.z + st.nz * strip.half * side);
        across.push(strip.half * side);
        along.push(st.along);
        half.push(strip.half);
        info.push(strip.cls, strip.lanes, (strip.oneway ? INFO_ONEWAY : 0) | marked, 0);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const l0 = base + k * 2;
      const a = strip.stations[k];
      const b = strip.stations[k + 1];
      // The triangles must face up whichever way the strip runs.
      const up = (b.x - a.x) * a.nz - (b.z - a.z) * a.nx > 0;
      const t = perTile[tileOf(tiles, (a.x + b.x) / 2, (a.z + b.z) / 2)];
      if (up) t.push(l0, l0 + 1, l0 + 2, l0 + 1, l0 + 3, l0 + 2);
      else t.push(l0, l0 + 2, l0 + 1, l0 + 1, l0 + 2, l0 + 3);
    }
  }

  const tileStart = new Uint32Array(perTile.length + 1);
  let count = 0;
  perTile.forEach((t, i) => {
    tileStart[i] = count;
    count += t.length;
  });
  tileStart[perTile.length] = count;
  const indices = new Uint32Array(count);
  perTile.forEach((t, i) => indices.set(t, tileStart[i]));

  return {
    positions: Float32Array.from(pos),
    across: Float32Array.from(across),
    along: Float32Array.from(along),
    half: Float32Array.from(half),
    info: Uint8Array.from(info),
    indices,
    tileStart,
    tiles,
  };
}

export function ribbonTransferables(m: RibbonMesh): ArrayBuffer[] {
  return [m.positions, m.across, m.along, m.half, m.info, m.indices, m.tileStart].map((a) => a.buffer as ArrayBuffer);
}
