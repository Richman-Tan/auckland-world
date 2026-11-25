/**
 * Which wall and roof colour a building gets (the style byte in buildings.bin). Pure.
 *
 * The wall index also says what kind of building it is, and the runtime relies on that:
 *   0-2  glass towers       3-5  commercial and civic       6-12  houses       13  industrial
 * Roofs: 0-3 corrugated iron and 4 tile for anything low, 5-7 flat concrete above that, and the
 * rest of the palette only where a mapper has recorded the real colour.
 */
import { ROOF_PALETTE, WALL_PALETTE, makeStyle } from '../../src/shared/palette';
import { hash32 } from './raster';

export const INDUSTRIAL = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'service', 'storage_tank', 'hangar', 'garage', 'garages', 'shed', 'container', 'boathouse', 'barn', 'farm_auxiliary']);
export const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'supermarket', 'hotel', 'civic', 'public', 'hospital', 'school', 'university', 'college', 'kindergarten', 'church', 'cathedral', 'government', 'train_station', 'transportation', 'stadium', 'sports_hall', 'apartments', 'parking']);

/** Below this a building is "low": a pitched roof in iron or tile rather than a flat slab. */
export const LOW_ROOF_BELOW = 10;

type Range = readonly [number, number];
export const WALL_RANGE = { glass: [0, 2], commercial: [3, 5], house: [6, 12], industrial: [13, 13] } as const satisfies Record<string, Range>;
export const ROOF_RANGE = { low: [0, 4], flat: [5, 7], flatTagged: [5, 15] } as const satisfies Record<string, Range>;

export type WallClass = keyof typeof WALL_RANGE;

export function wallClass(type: string, h: number): WallClass {
  if (h > 40) return 'glass';
  if (INDUSTRIAL.has(type)) return 'industrial';
  if (COMMERCIAL.has(type) || (type === 'yes' && h >= 12)) return 'commercial';
  return 'house';
}

const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#b22222', maroon: '#800000', brown: '#8b5a3c', orange: '#d2691e',
  yellow: '#e6c84a', beige: '#e8dcc0', cream: '#f1e9cf', tan: '#c8ad82', green: '#4f6f4a', darkgreen: '#2f4f2f',
  blue: '#4a6fa5', lightblue: '#a8c8dc', teal: '#2f6f73', grey: '#808080', gray: '#808080',
  lightgrey: '#d3d3d3', lightgray: '#d3d3d3', darkgrey: '#555555', darkgray: '#555555', silver: '#c0c0c0',
};

/** An OSM colour value ("#a2a0a0", "#abc", "red") as [r, g, b], or null if it is not one we know. */
export function parseColour(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  let v = value.trim().toLowerCase().replace(/[\s_-]/g, '');
  v = NAMED[v] ?? v;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * The palette entry in [lo, hi] closest to a colour. Hue counts for more than brightness: a bright
 * turquoise roof should land on the dark teal metal, not on pale concrete that happens to be as light.
 */
export function nearestIndex(rgb: readonly [number, number, number], palette: readonly string[], [lo, hi]: Range): number {
  const split = (c: readonly [number, number, number]) => {
    const l = (c[0] + c[1] + c[2]) / 3;
    return [l, c[0] - l, c[1] - l, c[2] - l];
  };
  const want = split(rgb);
  let best = lo;
  let bestD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const p = parseColour(palette[i]);
    if (!p) continue;
    const have = split(p);
    const d = (have[0] - want[0]) ** 2 + 4 * ((have[1] - want[1]) ** 2 + (have[2] - want[2]) ** 2 + (have[3] - want[3]) ** 2);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface StyleTags {
  'building:colour'?: string;
  'roof:colour'?: string;
}

/**
 * `id` seeds the choice, so a building keeps its colours from build to build. A recorded colour
 * wins, but only among the entries that fit the building's kind, so the kind stays readable.
 */
export function pickStyle(id: number, type: string, h: number, tags: StyleTags = {}): number {
  // hash32 is unsigned: shifts must be unsigned too, or half the buildings index off the end.
  const hv = hash32(id) >>> 0;
  const cls = wallClass(type, h);
  let wall: number;
  if (cls === 'glass') wall = hv % 3;
  else if (cls === 'industrial') wall = 13;
  else if (cls === 'commercial') wall = 3 + (hv % 3);
  // houses and ordinary small buildings: weatherboard and villa pastels, one in seven brick
  else wall = (hv >>> 4) % 7 === 0 ? 11 + ((hv >>> 8) % 2) : 6 + (hv % 5);
  const wallTag = parseColour(tags['building:colour']);
  if (wallTag) wall = nearestIndex(wallTag, WALL_PALETTE, WALL_RANGE[cls]);

  const low = h < LOW_ROOF_BELOW;
  let roof: number;
  if (low) roof = (hv >>> 12) % 6 === 0 ? 4 : (hv >>> 16) % 4;
  else roof = 5 + ((hv >>> 12) % 3);
  const roofTag = parseColour(tags['roof:colour']);
  if (roofTag) roof = nearestIndex(roofTag, ROOF_PALETTE, low ? ROOF_RANGE.low : ROOF_RANGE.flatTagged);
  return makeStyle(wall, roof);
}
