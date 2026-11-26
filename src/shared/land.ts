/**
 * What the ground is, cell by cell (land.bin, see mapFormat.ts): a kind of land and how tall the
 * trees over it are. The ground image says what colour the land is from the air; this says what it
 * is, which is what lets the ground near the plane be drawn as grass, sand, yards or a car park
 * instead of as three-metre squares of flat colour. Pure: the pipeline writes with these tables and
 * the runtime reads with them.
 */

/** Class code = index. The ground image paints each in the colour named in LAND_COLOUR. */
export const LAND_CLASSES = [
  'land', 'residential', 'commercial', 'industrial', 'parking', 'park', 'pitch', 'wood', 'scrub', 'sand', 'rock', 'water',
] as const;
export type LandClass = (typeof LAND_CLASSES)[number];
export const landCode = (c: LandClass): number => LAND_CLASSES.indexOf(c);

/** The palette entry (GROUND in palette.ts) each class is painted with in the ground image. */
export const LAND_COLOUR: Record<LandClass, 'land' | 'residential' | 'commercial' | 'industrial' | 'park' | 'pitch' | 'wood' | 'scrub' | 'sand' | 'rock' | 'inlandWater'> = {
  land: 'land',
  residential: 'residential',
  commercial: 'commercial',
  industrial: 'industrial',
  parking: 'industrial',
  park: 'park',
  pitch: 'pitch',
  wood: 'wood',
  scrub: 'scrub',
  sand: 'sand',
  rock: 'rock',
  water: 'inlandWater',
};

/** Size of a cell in metres. */
export const LAND_CELL = 6;

/**
 * Tree canopy over a cell, from LiDAR: 0 none, then how tall. A cell counts as canopy when at
 * least CANOPY_MIN_COVER of it stands this far above the ground and is as rough as foliage.
 */
export const CANOPY_NONE = 0;
export const CANOPY_LOW = 1;
export const CANOPY_MID = 2;
export const CANOPY_TALL = 3;
/** Lowest height that counts as a tree, and where the middle and tall classes begin, metres. */
export const CANOPY_HEIGHTS = [3, 7, 14] as const;
export const CANOPY_MIN_COVER = 0.4;
export function canopyClass(height: number): number {
  if (!(height >= CANOPY_HEIGHTS[0])) return CANOPY_NONE;
  return height >= CANOPY_HEIGHTS[2] ? CANOPY_TALL : height >= CANOPY_HEIGHTS[1] ? CANOPY_MID : CANOPY_LOW;
}
/** A representative height for a canopy class, for whatever stands a tree there. */
export const CANOPY_TYPICAL = [0, 5, 10, 18] as const;

/**
 * The class at a point between four cell centres. Each corner's weight is its bilinear weight; the
 * class with the most weight wins. Used instead of the nearest cell so a boundary between two kinds
 * of land runs smoothly through the cells instead of in six-metre steps. `fx`, `fy` are the
 * position between the centres, 0 to 1; ties go to the earlier corner (c00, c10, c01, c11).
 *
 * The terrain shader does exactly this (voteClass in render/materials.ts); this copy is the one
 * that is tested.
 */
export function voteClass(c00: number, c10: number, c01: number, c11: number, fx: number, fy: number): number {
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const s00 = w00 + (c10 === c00 ? w10 : 0) + (c01 === c00 ? w01 : 0) + (c11 === c00 ? w11 : 0);
  const s10 = w10 + (c00 === c10 ? w00 : 0) + (c01 === c10 ? w01 : 0) + (c11 === c10 ? w11 : 0);
  const s01 = w01 + (c00 === c01 ? w00 : 0) + (c10 === c01 ? w10 : 0) + (c11 === c01 ? w11 : 0);
  const s11 = w11 + (c00 === c11 ? w00 : 0) + (c10 === c11 ? w10 : 0) + (c01 === c11 ? w01 : 0);
  let best = c00;
  let top = s00;
  if (s10 > top) {
    best = c10;
    top = s10;
  }
  if (s01 > top) {
    best = c01;
    top = s01;
  }
  if (s11 > top) best = c11;
  return best;
}

export interface LandGrid {
  /** Cells across and down; row 0 is the north edge. */
  width: number;
  height: number;
  /** Cell size, metres. */
  cell: number;
  /** Class code per cell (index into LAND_CLASSES). */
  cls: Uint8Array;
  /** Canopy class per cell (CANOPY_NONE to CANOPY_TALL). */
  canopy: Uint8Array;
}

/** The cell a point falls in, or -1 outside the grid. `minX`, `minZ` are the map's north-west corner. */
export function landCellAt(g: Pick<LandGrid, 'width' | 'height' | 'cell'>, minX: number, minZ: number, x: number, z: number): number {
  const c = Math.floor((x - minX) / g.cell);
  const r = Math.floor((z - minZ) / g.cell);
  return c < 0 || r < 0 || c >= g.width || r >= g.height ? -1 : r * g.width + c;
}

/**
 * The two-channel image the terrain shader reads: the class in the first channel (read cell by
 * cell) and canopy, there or not, in the second (read smoothed, so it has soft edges and thins out
 * with distance instead of sparkling).
 */
export function landTexture(g: LandGrid): Uint8Array {
  const out = new Uint8Array(g.width * g.height * 2);
  for (let i = 0; i < g.width * g.height; i++) {
    out[i * 2] = g.cls[i];
    out[i * 2 + 1] = g.canopy[i] ? 255 : 0;
  }
  return out;
}
