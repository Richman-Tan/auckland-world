/**
 * The baked map formats, shared by the pipeline (scripts/) and the runtime (src/).
 * Pure TypeScript: no DOM, no three, no node. Gzip is handled by the caller
 * (node:zlib in the pipeline, DecompressionStream in the browser).
 *
 * World frame: NZTM2000-local metres. x = E - originE (east), z = -(N - originN)
 * (so north is -z), y = up, metres above sea level. All binary data is little-endian.
 */
import type { LandGrid } from './land';


export const MAP_FORMAT_VERSION = 1;

/* ------------------------------------------------------------------ meta.json */

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Quadratic in (dLat, dLon) = (lat - ref.lat, lon - ref.lon): c0 + c1*dLat + c2*dLon + c3*dLat^2 + c4*dLat*dLon + c5*dLon^2. */
export type Poly2 = [number, number, number, number, number, number];

export interface GeoFit {
  ref: { lat: number; lon: number };
  toLocal: { x: Poly2; z: Poly2 };
  /** Inverse fit, in (dx, dz) = (x, z) local metres: same polynomial form, giving lat and lon directly. */
  toLatLon: { lat: Poly2; lon: Poly2 };
  maxResidualM: number;
}

export interface FileEntry {
  bytes: number;
  sha256: string;
}

export interface MapMeta {
  version: number;
  generatedAt: string;
  /** True for the synthetic map in public/map-fake. */
  fake?: boolean;
  sources: {
    osm?: { baseTimestamp: string };
    linz?: { collection: string; tiles: string[]; captured: string };
  };
  attribution: string[];
  crs: {
    epsg: 2193;
    originE: number;
    originN: number;
    /** Clockwise angle from grid north (-z) to true north, radians. trueHeading = gridHeading - trueNorthAngleRad. */
    trueNorthAngleRad: number;
  };
  geo: GeoFit;
  bounds: Bounds;
  latLonBounds: { south: number; west: number; north: number; east: number };
  water: { level: number };
  terrain: { file: string; cols: number; rows: number; cell: number; minH: number; maxH: number };
  buildings: { file: string; count: number; rings: number; vertices: number; maxHeight: number };
  collision: { cell: number };
  ground: { file: string; loFile: string; width: number; height: number; metresPerPixel: number };
  minimap: { file: string; width: number; height: number };
  landmarks: {
    skyTower: { x: number; z: number; groundY: number; height: number };
    harbourBridge: {
      a: { x: number; z: number };
      b: { x: number; z: number };
      /** Distance between profile samples along a -> b, metres. */
      step: number;
      /** Deck height (m ASL) at each sample along a -> b. */
      deckY: number[];
      /** Truss top height (m ASL) at each sample along a -> b. */
      topY: number[];
      /** The ground under each sample, 0 over the sea. Absent on maps built before it was measured. */
      groundY?: number[];
      /** Highest point of the truss: where the "Talk to me" beacon sits. */
      archTop: { x: number; z: number; y: number };
    };
    rangitoto: { x: number; z: number; summitY: number; baseRadius: number };
  };
  places: { name: string; kind: string; x: number; z: number }[];
  /**
   * Close-up detail, loaded after the city is first shown. Every part is optional: a map without
   * one simply has less to see up close, and an older site ignores what it does not know.
   */
  detail?: {
    /** Road and rail centre lines (roads.bin). */
    roads?: { file: string; ways: number; vertices: number };
    /** What the ground is, cell by cell, and the tree canopy over it (land.bin). */
    land?: { file: string; width: number; height: number; cell: number };
    /** Piers and the berths along them (harbour.bin). */
    harbour?: { file: string; piers: number; vertices: number; berths: number };
  };
  files: Record<string, FileEntry>;
}

export function isMapMeta(v: unknown): v is MapMeta {
  if (!v || typeof v !== 'object') return false;
  const m = v as Partial<MapMeta>;
  return (
    m.version === MAP_FORMAT_VERSION &&
    !!m.bounds &&
    !!m.terrain &&
    !!m.buildings &&
    !!m.ground &&
    !!m.minimap &&
    !!m.geo &&
    !!m.landmarks &&
    Array.isArray(m.places) &&
    Array.isArray(m.attribution)
  );
}

/**
 * The URL of one of the map's files, with the start of its hash as a query. The address then changes
 * exactly when the file does, so a browser can keep its copy for as long as it likes and still never
 * show a stale one. A file the map does not list keeps its plain address.
 */
export function mapFileUrl(base: string, meta: Pick<MapMeta, 'files'>, name: string): string {
  const hash = meta.files?.[name]?.sha256;
  return hash ? `${base}${name}?v=${hash.slice(0, 12)}` : `${base}${name}`;
}

/* --------------------------------------------------------------- geo helpers */

export function evalPoly2(c: Poly2, a: number, b: number): number {
  return c[0] + c[1] * a + c[2] * b + c[3] * a * a + c[4] * a * b + c[5] * b * b;
}

export function latLonToLocal(geo: GeoFit, lat: number, lon: number): { x: number; z: number } {
  const a = lat - geo.ref.lat;
  const b = lon - geo.ref.lon;
  return { x: evalPoly2(geo.toLocal.x, a, b), z: evalPoly2(geo.toLocal.z, a, b) };
}

export function localToLatLon(geo: GeoFit, x: number, z: number): { lat: number; lon: number } {
  return { lat: evalPoly2(geo.toLatLon.lat, x, z), lon: evalPoly2(geo.toLatLon.lon, x, z) };
}

/* ----------------------------------------------------------------- gzip sniff */

/** Some hosts serve .gz with Content-Encoding: gzip, so the browser has already inflated it. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/* -------------------------------------------------------------- binary utils */

class Writer {
  private buf: ArrayBuffer;
  private view: DataView;
  private u8: Uint8Array;
  pos = 0;
  constructor(initial = 1 << 16) {
    this.buf = new ArrayBuffer(initial);
    this.view = new DataView(this.buf);
    this.u8 = new Uint8Array(this.buf);
  }
  private ensure(n: number) {
    if (this.pos + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.pos + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.u8);
    this.buf = next;
    this.view = new DataView(next);
    this.u8 = new Uint8Array(next);
  }
  magic(s: string) {
    this.ensure(4);
    for (let i = 0; i < 4; i++) this.u8[this.pos + i] = s.charCodeAt(i);
    this.pos += 4;
  }
  u8v(v: number) { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2; }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.pos, v, true); this.pos += 4; }
  f32(v: number) { this.ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; }
  pad4() { while (this.pos % 4) this.u8v(0); }
  bytes(): Uint8Array { return this.u8.slice(0, this.pos); }
}

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private u8: Uint8Array) {
    this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  }
  magic(expect: string) {
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.u8[this.pos + i]);
    this.pos += 4;
    if (s !== expect) throw new Error(`Bad magic: expected ${expect}, got ${JSON.stringify(s)}`);
  }
  u8v() { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  pad4() { while (this.pos % 4) this.pos++; }
  check(n: number) {
    if (this.pos + n > this.u8.byteLength) throw new Error('Truncated map file');
  }
}

function toI16(v: number): number {
  const r = Math.round(v);
  if (r < -32768 || r > 32767) throw new Error(`Value ${v} out of int16 range`);
  return r;
}

/* ------------------------------------------------------------------- terrain */

/**
 * terrain.bin layout (little-endian):
 *  0  char[4] "AWT1"   4 u16 version   6 u16 flags (bit0 = row-delta coded)
 *  8  u32 cols   12 u32 rows   16 f32 cell (m)
 *  20 f32 x0 (= bounds.minX)   24 f32 z0 (= bounds.minZ, the north edge)   28 f32 zStep (m per unit)
 *  32 f32 minH   36 f32 maxH
 *  40 i16[rows*cols] heights / zStep, row-major north -> south, west -> east.
 *     Row-delta coded: each row's first value is absolute, then deltas from the previous value.
 * Vertex (c, r) sits at x = x0 + c*cell, z = z0 + r*cell.
 */
export interface TerrainGrid {
  cols: number;
  rows: number;
  cell: number;
  x0: number;
  z0: number;
  minH: number;
  maxH: number;
  /** Heights in metres ASL, row-major north -> south. Sea vertices are negative. */
  heights: Float32Array;
}

const TERRAIN_ZSTEP = 0.1;

export function encodeTerrain(t: TerrainGrid): Uint8Array {
  const w = new Writer(40 + t.cols * t.rows * 2);
  w.magic('AWT1');
  w.u16(MAP_FORMAT_VERSION);
  w.u16(1);
  w.u32(t.cols);
  w.u32(t.rows);
  w.f32(t.cell);
  w.f32(t.x0);
  w.f32(t.z0);
  w.f32(TERRAIN_ZSTEP);
  let minH = Infinity;
  let maxH = -Infinity;
  for (const h of t.heights) {
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  w.f32(minH);
  w.f32(maxH);
  for (let r = 0; r < t.rows; r++) {
    let prev = 0;
    for (let c = 0; c < t.cols; c++) {
      const q = toI16(t.heights[r * t.cols + c] / TERRAIN_ZSTEP);
      w.i16(c === 0 ? q : toI16(q - prev));
      prev = q;
    }
  }
  w.pad4();
  return w.bytes();
}

export function decodeTerrain(bytes: Uint8Array): TerrainGrid {
  const r = new Reader(bytes);
  r.magic('AWT1');
  const version = r.u16();
  if (version !== MAP_FORMAT_VERSION) throw new Error(`terrain.bin version ${version} unsupported`);
  const flags = r.u16();
  const cols = r.u32();
  const rows = r.u32();
  const cell = r.f32();
  const x0 = r.f32();
  const z0 = r.f32();
  const zStep = r.f32();
  const minH = r.f32();
  const maxH = r.f32();
  r.check(cols * rows * 2);
  const heights = new Float32Array(cols * rows);
  const delta = (flags & 1) === 1;
  for (let row = 0; row < rows; row++) {
    let prev = 0;
    for (let c = 0; c < cols; c++) {
      const v = r.i16();
      const q = delta && c > 0 ? prev + v : v;
      heights[row * cols + c] = q * zStep;
      prev = q;
    }
  }
  return { cols, rows, cell, x0, z0, minH, maxH, heights };
}

/** Bilinear terrain height at local (x, z). Clamps outside the grid. */
export function sampleTerrain(t: TerrainGrid, x: number, z: number): number {
  let fx = (x - t.x0) / t.cell;
  let fz = (z - t.z0) / t.cell;
  fx = Math.min(Math.max(fx, 0), t.cols - 1.0001);
  fz = Math.min(Math.max(fz, 0), t.rows - 1.0001);
  const c = Math.floor(fx);
  const r = Math.floor(fz);
  const u = fx - c;
  const v = fz - r;
  const i = r * t.cols + c;
  const h00 = t.heights[i];
  const h10 = t.heights[i + 1];
  const h01 = t.heights[i + t.cols];
  const h11 = t.heights[i + t.cols + 1];
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}

/* ----------------------------------------------------------------- buildings */

/**
 * buildings.bin layout (little-endian, struct of arrays; every section padded to 4 bytes):
 *  0  char[4] "AWB1"   4 u16 version   6 u16 flags (bit0 = xz delta coded)
 *  8  u32 B (buildings)   12 u32 R (rings)   16 u32 V (vertices)
 *  20 f32 xzStep (m per unit, 0.25)   24 f32 zStep (m per unit, 0.1)   28 u32 reserved
 *  S1 u8[B]   rings per building (outer ring first, then holes)
 *  S2 u16[R]  vertices per ring (>= 3, ring not closed)
 *  S3 i16[B]  baseY / zStep  (absolute m ASL; includes the skirt below ground)
 *  S4 i16[B]  topY / zStep   (absolute m ASL)
 *  S5 u8[B]   style: low nibble = wall palette index, high nibble = roof palette index
 *  S6 i16[2V] (x, z) / xzStep; the first vertex of each ring absolute, then deltas from the previous vertex
 * Outer rings are counter-clockwise on a north-up map (positive signed area in (x, -z)), holes clockwise.
 */
export interface BuildingRecord {
  /** rings[0] is the outer ring, the rest are holes. Each ring is a flat [x0, z0, x1, z1, ...] list, not closed. */
  rings: number[][];
  baseY: number;
  topY: number;
  style: number;
}

export interface BuildingsData {
  count: number;
  ringCount: number;
  vertexCount: number;
  ringsPerBuilding: Uint8Array;
  verticesPerRing: Uint16Array;
  baseY: Float32Array;
  topY: Float32Array;
  style: Uint8Array;
  /** Flat (x, z) pairs for every vertex, in metres. */
  xz: Float32Array;
  /** Index of each building's first ring. Length count + 1. */
  buildingRingStart: Uint32Array;
  /** Index of each ring's first vertex (in vertices, not floats). Length ringCount + 1. */
  ringVertexStart: Uint32Array;
}

const XZ_STEP = 0.25;
const Y_STEP = 0.1;

export function encodeBuildings(list: BuildingRecord[]): Uint8Array {
  let R = 0;
  let V = 0;
  for (const b of list) {
    if (b.rings.length < 1 || b.rings.length > 255) throw new Error('Building must have 1-255 rings');
    R += b.rings.length;
    for (const ring of b.rings) {
      if (ring.length < 6 || ring.length % 2) throw new Error('Ring must have >= 3 (x, z) vertices');
      if (ring.length / 2 > 65535) throw new Error('Ring too long');
      V += ring.length / 2;
    }
  }
  const w = new Writer(32 + list.length * 6 + R * 2 + V * 4 + 16);
  w.magic('AWB1');
  w.u16(MAP_FORMAT_VERSION);
  w.u16(1);
  w.u32(list.length);
  w.u32(R);
  w.u32(V);
  w.f32(XZ_STEP);
  w.f32(Y_STEP);
  w.u32(0);
  for (const b of list) w.u8v(b.rings.length);
  w.pad4();
  for (const b of list) for (const ring of b.rings) w.u16(ring.length / 2);
  w.pad4();
  for (const b of list) w.i16(toI16(b.baseY / Y_STEP));
  w.pad4();
  for (const b of list) w.i16(toI16(b.topY / Y_STEP));
  w.pad4();
  for (const b of list) w.u8v(b.style & 0xff);
  w.pad4();
  for (const b of list) {
    for (const ring of b.rings) {
      let px = 0;
      let pz = 0;
      for (let i = 0; i < ring.length; i += 2) {
        const qx = toI16(ring[i] / XZ_STEP);
        const qz = toI16(ring[i + 1] / XZ_STEP);
        if (i === 0) {
          w.i16(qx);
          w.i16(qz);
        } else {
          w.i16(toI16(qx - px));
          w.i16(toI16(qz - pz));
        }
        px = qx;
        pz = qz;
      }
    }
  }
  w.pad4();
  return w.bytes();
}

export function decodeBuildings(bytes: Uint8Array): BuildingsData {
  const r = new Reader(bytes);
  r.magic('AWB1');
  const version = r.u16();
  if (version !== MAP_FORMAT_VERSION) throw new Error(`buildings.bin version ${version} unsupported`);
  const flags = r.u16();
  const B = r.u32();
  const R = r.u32();
  const V = r.u32();
  const xzStep = r.f32();
  const yStep = r.f32();
  r.u32();
  r.check(B * 6 + R * 2 + V * 4);

  const ringsPerBuilding = new Uint8Array(B);
  for (let i = 0; i < B; i++) ringsPerBuilding[i] = r.u8v();
  r.pad4();
  const verticesPerRing = new Uint16Array(R);
  for (let i = 0; i < R; i++) verticesPerRing[i] = r.u16();
  r.pad4();
  const baseY = new Float32Array(B);
  for (let i = 0; i < B; i++) baseY[i] = r.i16() * yStep;
  r.pad4();
  const topY = new Float32Array(B);
  for (let i = 0; i < B; i++) topY[i] = r.i16() * yStep;
  r.pad4();
  const style = new Uint8Array(B);
  for (let i = 0; i < B; i++) style[i] = r.u8v();
  r.pad4();

  const buildingRingStart = new Uint32Array(B + 1);
  for (let i = 0; i < B; i++) buildingRingStart[i + 1] = buildingRingStart[i] + ringsPerBuilding[i];
  if (buildingRingStart[B] !== R) throw new Error('Ring count mismatch');
  const ringVertexStart = new Uint32Array(R + 1);
  for (let i = 0; i < R; i++) ringVertexStart[i + 1] = ringVertexStart[i] + verticesPerRing[i];
  if (ringVertexStart[R] !== V) throw new Error('Vertex count mismatch');

  const delta = (flags & 1) === 1;
  const xz = new Float32Array(V * 2);
  for (let ring = 0; ring < R; ring++) {
    let px = 0;
    let pz = 0;
    for (let v = ringVertexStart[ring]; v < ringVertexStart[ring + 1]; v++) {
      const ax = r.i16();
      const az = r.i16();
      const first = v === ringVertexStart[ring];
      const qx = delta && !first ? px + ax : ax;
      const qz = delta && !first ? pz + az : az;
      xz[v * 2] = qx * xzStep;
      xz[v * 2 + 1] = qz * xzStep;
      px = qx;
      pz = qz;
    }
  }
  return {
    count: B,
    ringCount: R,
    vertexCount: V,
    ringsPerBuilding,
    verticesPerRing,
    baseY,
    topY,
    style,
    xz,
    buildingRingStart,
    ringVertexStart,
  };
}

/** Signed area of a flat (x, z) ring on a north-up map (x east, -z north). Positive = counter-clockwise. */
export function ringSignedAreaNorthUp(ring: ArrayLike<number>, start = 0, end = ring.length): number {
  let a = 0;
  const n = (end - start) / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = ring[start + i * 2];
    const y1 = -ring[start + i * 2 + 1];
    const x2 = ring[start + j * 2];
    const y2 = -ring[start + j * 2 + 1];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/* --------------------------------------------------------------------- roads */

/**
 * roads.bin layout (little-endian, sections padded to 4 bytes):
 *  0  char[4] "AWR1"   4 u16 version   6 u16 flags (0)
 *  8  u32 W ways   12 u32 V vertices   16 f32 xzStep (m per unit)
 *  S1 u8[W]  class (index into ROAD_CLASSES in ./roads)
 *  S2 u8[W]  flags (bit 0 one-way, bit 1 bridge, bits 4-7 lanes, 0 = not recorded)
 *  S3 u16[W] vertices per way
 *  S4 i16[2V] (x, z) / xzStep: each way's first vertex absolute, then deltas from the previous vertex
 * Ways are in painting order, minor roads first.
 */
export interface RoadWay {
  cls: number;
  flags: number;
  /** x0, z0, x1, z1, ... in local metres; at least two vertices. */
  line: ArrayLike<number>;
}

export interface RoadsData {
  count: number;
  vertexCount: number;
  cls: Uint8Array;
  flags: Uint8Array;
  /** Index of each way's first vertex; one extra entry at the end holds vertexCount. */
  wayStart: Uint32Array;
  /** x, z per vertex, metres. */
  xz: Float32Array;
}

export function encodeRoads(list: readonly RoadWay[]): Uint8Array {
  let V = 0;
  for (const r of list) {
    const n = r.line.length / 2;
    if (r.line.length % 2 || n < 2 || n > 65535) throw new Error('A road needs 2 to 65535 (x, z) vertices');
    V += n;
  }
  const w = new Writer(32 + list.length * 4 + V * 4);
  w.magic('AWR1');
  w.u16(MAP_FORMAT_VERSION);
  w.u16(0);
  w.u32(list.length);
  w.u32(V);
  w.f32(XZ_STEP);
  for (const r of list) w.u8v(r.cls & 0xff);
  w.pad4();
  for (const r of list) w.u8v(r.flags & 0xff);
  w.pad4();
  for (const r of list) w.u16(r.line.length / 2);
  w.pad4();
  for (const r of list) {
    let px = 0;
    let pz = 0;
    for (let i = 0; i < r.line.length; i += 2) {
      const qx = toI16(r.line[i] / XZ_STEP);
      const qz = toI16(r.line[i + 1] / XZ_STEP);
      w.i16(i === 0 ? qx : toI16(qx - px));
      w.i16(i === 0 ? qz : toI16(qz - pz));
      px = qx;
      pz = qz;
    }
  }
  w.pad4();
  return w.bytes();
}

/* --------------------------------------------------------------- harbour.bin */

/** A pier's outline (x, z pairs, not closed) and whether it floats (a marina pontoon) or stands on piles. */
export interface Pier {
  ring: number[];
  floating: boolean;
}
/** A berth: where a moored boat's middle is, which way its bow points (radians, 0 = north, clockwise) and how long it is. */
export interface Berth {
  x: number;
  z: number;
  heading: number;
  length: number;
}
export interface HarbourData {
  piers: Pier[];
  berths: Berth[];
}

/**
 * harbour.bin ("AWH1"): u16 version, u16 0, u32 piers, u32 vertices, u32 berths, f32 xz step; then
 * a byte a pier (1 = floating), a u16 a pier (its vertex count), the vertices as i16 steps (the
 * first of each pier absolute, the rest as differences), and four numbers a berth: x and z as i16
 * steps, heading as a byte (256 to the turn) and length as a byte (decimetres). Sections are padded to four.
 */
export function encodeHarbour(h: HarbourData): Uint8Array {
  let V = 0;
  for (const p of h.piers) {
    const n = p.ring.length / 2;
    if (p.ring.length % 2 || n < 3 || n > 65535) throw new Error('A pier needs 3 to 65535 (x, z) vertices');
    V += n;
  }
  const w = new Writer(32 + h.piers.length * 4 + V * 4 + h.berths.length * 6);
  w.magic('AWH1');
  w.u16(MAP_FORMAT_VERSION);
  w.u16(0);
  w.u32(h.piers.length);
  w.u32(V);
  w.u32(h.berths.length);
  w.f32(XZ_STEP);
  for (const p of h.piers) w.u8v(p.floating ? 1 : 0);
  w.pad4();
  for (const p of h.piers) w.u16(p.ring.length / 2);
  w.pad4();
  for (const p of h.piers) {
    let px = 0;
    let pz = 0;
    for (let i = 0; i < p.ring.length; i += 2) {
      const qx = toI16(p.ring[i] / XZ_STEP);
      const qz = toI16(p.ring[i + 1] / XZ_STEP);
      w.i16(i === 0 ? qx : toI16(qx - px));
      w.i16(i === 0 ? qz : toI16(qz - pz));
      px = qx;
      pz = qz;
    }
  }
  w.pad4();
  for (const b of h.berths) {
    w.i16(toI16(b.x / XZ_STEP));
    w.i16(toI16(b.z / XZ_STEP));
    const turn = (((b.heading / (2 * Math.PI)) % 1) + 1) % 1;
    w.u8v(Math.round(turn * 256) & 255);
    w.u8v(Math.min(255, Math.max(0, Math.round(b.length * 10))));
  }
  w.pad4();
  return w.bytes();
}

export function decodeHarbour(bytes: Uint8Array): HarbourData {
  const r = new Reader(bytes);
  r.check(24);
  r.magic('AWH1');
  const version = r.u16();
  if (version !== MAP_FORMAT_VERSION) throw new Error(`harbour.bin version ${version} unsupported`);
  r.u16();
  const P = r.u32();
  const V = r.u32();
  const B = r.u32();
  const step = r.f32();
  r.check(P * 3 + V * 4 + B * 6);
  const floating: boolean[] = [];
  for (let i = 0; i < P; i++) floating.push(r.u8v() === 1);
  r.pad4();
  const counts: number[] = [];
  let total = 0;
  for (let i = 0; i < P; i++) {
    counts.push(r.u16());
    total += counts[i];
  }
  if (total !== V) throw new Error('harbour.bin: vertex counts do not add up');
  r.pad4();
  const piers: Pier[] = [];
  for (let i = 0; i < P; i++) {
    const ring: number[] = [];
    let px = 0;
    let pz = 0;
    for (let v = 0; v < counts[i]; v++) {
      const dx = r.i16();
      const dz = r.i16();
      px = v === 0 ? dx : px + dx;
      pz = v === 0 ? dz : pz + dz;
      ring.push(px * step, pz * step);
    }
    piers.push({ ring, floating: floating[i] });
  }
  r.pad4();
  const berths: Berth[] = [];
  for (let i = 0; i < B; i++) {
    const x = r.i16() * step;
    const z = r.i16() * step;
    const heading = (r.u8v() / 256) * 2 * Math.PI;
    const length = r.u8v() / 10;
    berths.push({ x, z, heading, length });
  }
  return { piers, berths };
}

/* ------------------------------------------------------------------ land.bin */

/**
 * land.bin ("AWL1"): u16 version, u16 cell size in decimetres, u32 width, u32 height, then two
 * planes of width x height bytes, each padded to four: the class of every cell and its canopy class
 * (src/shared/land.ts). Every row is stored as its difference (XOR) from the row above, which is
 * mostly zeros and so packs to a fraction of the size.
 */
function xorRows(plane: Uint8Array, width: number, undo: boolean): Uint8Array {
  const out = new Uint8Array(plane.length);
  for (let i = 0; i < plane.length; i++) {
    const above = i >= width ? (undo ? out[i - width] : plane[i - width]) : 0;
    out[i] = plane[i] ^ above;
  }
  return out;
}

export function encodeLand(g: LandGrid): Uint8Array {
  const n = g.width * g.height;
  if (g.cls.length !== n || g.canopy.length !== n) throw new Error('land.bin: planes do not match the grid');
  const w = new Writer(24 + n * 2);
  w.magic('AWL1');
  w.u16(MAP_FORMAT_VERSION);
  w.u16(Math.round(g.cell * 10));
  w.u32(g.width);
  w.u32(g.height);
  for (const plane of [g.cls, g.canopy]) {
    const rows = xorRows(plane, g.width, false);
    for (let i = 0; i < n; i++) w.u8v(rows[i]);
    w.pad4();
  }
  return w.bytes();
}

export function decodeLand(bytes: Uint8Array): LandGrid {
  const r = new Reader(bytes);
  r.check(16);
  r.magic('AWL1');
  const version = r.u16();
  if (version !== MAP_FORMAT_VERSION) throw new Error(`land.bin version ${version} unsupported`);
  const cell = r.u16() / 10;
  const width = r.u32();
  const height = r.u32();
  const n = width * height;
  if (!(cell > 0) || n <= 0 || n > 64e6) throw new Error('land.bin: bad grid size');
  r.check(n * 2);
  const plane = () => {
    const raw = new Uint8Array(n);
    for (let i = 0; i < n; i++) raw[i] = r.u8v();
    r.pad4();
    return xorRows(raw, width, true);
  };
  const cls = plane();
  const canopy = plane();
  return { width, height, cell, cls, canopy };
}

export function decodeRoads(bytes: Uint8Array): RoadsData {
  const r = new Reader(bytes);
  r.check(20);
  r.magic('AWR1');
  const version = r.u16();
  if (version !== MAP_FORMAT_VERSION) throw new Error(`roads.bin version ${version} unsupported`);
  r.u16();
  const W = r.u32();
  const V = r.u32();
  const step = r.f32();
  r.check(W * 4 + V * 4);
  const cls = new Uint8Array(W);
  for (let i = 0; i < W; i++) cls[i] = r.u8v();
  r.pad4();
  const flags = new Uint8Array(W);
  for (let i = 0; i < W; i++) flags[i] = r.u8v();
  r.pad4();
  const wayStart = new Uint32Array(W + 1);
  let total = 0;
  for (let i = 0; i < W; i++) {
    wayStart[i] = total;
    total += r.u16();
  }
  wayStart[W] = total;
  if (total !== V) throw new Error('roads.bin: vertex counts do not add up');
  r.pad4();
  const xz = new Float32Array(V * 2);
  for (let i = 0; i < W; i++) {
    let px = 0;
    let pz = 0;
    for (let v = wayStart[i]; v < wayStart[i + 1]; v++) {
      const dx = r.i16();
      const dz = r.i16();
      px = v === wayStart[i] ? dx : px + dx;
      pz = v === wayStart[i] ? dz : pz + dz;
      xz[v * 2] = px * step;
      xz[v * 2 + 1] = pz * step;
    }
  }
  return { count: W, vertexCount: V, cls, flags, wayStart, xz };
}
