/**
 * Roads as the map ships them (roads.bin, see mapFormat.ts) and how wide each is drawn. Pure: the
 * pipeline writes with these tables and the runtime reads with them.
 */

/** Class code = index. Minor to major, the order they are painted in; rail last. */
export const ROAD_CLASSES = [
  'service', 'living_street', 'road', 'unclassified', 'residential', 'tertiary_link', 'tertiary', 'secondary_link',
  'secondary', 'primary_link', 'primary', 'trunk_link', 'trunk', 'motorway_link', 'motorway', 'rail',
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];
export const RAIL = ROAD_CLASSES.indexOf('rail');
const code = (c: RoadClass) => ROAD_CLASSES.indexOf(c);

/** Flag bits in roads.bin; the lane count (0 = not recorded) is in the top four bits. */
export const ROAD_ONEWAY = 1;
export const ROAD_BRIDGE = 2;
export const roadLanes = (flags: number) => flags >> 4;
export const roadFlags = (lanes: number, oneway: boolean, bridge: boolean) =>
  (Math.min(15, Math.max(0, Math.round(lanes))) << 4) | (oneway ? ROAD_ONEWAY : 0) | (bridge ? ROAD_BRIDGE : 0);

/** One traffic lane, and the strip of seal either side of the outer lanes. */
export const LANE_WIDTH = 3.3;
const SHOULDER = 0.5;
/** Lanes assumed where none are recorded (two-way unless the way is one-way). */
const DEFAULT_LANES: Record<RoadClass, number> = {
  service: 1, living_street: 1, road: 2, unclassified: 2, residential: 2, tertiary_link: 1, tertiary: 2, secondary_link: 1,
  secondary: 2, primary_link: 1, primary: 2, trunk_link: 1, trunk: 2, motorway_link: 1, motorway: 3, rail: 1,
};

/** Lanes on this way: what was recorded, or a guess from its class. */
export function lanesOf(cls: number, flags: number): number {
  const recorded = roadLanes(flags);
  if (recorded > 0) return recorded;
  const guess = DEFAULT_LANES[ROAD_CLASSES[cls] ?? 'road'];
  return flags & ROAD_ONEWAY ? Math.max(1, Math.ceil(guess / 2)) : guess;
}

/** Half the sealed width, kerb to kerb, in metres. */
export function carriagewayHalfWidth(cls: number, flags: number): number {
  if (cls === RAIL) return 1.6;
  if (cls === code('service')) return 1.9;
  return (lanesOf(cls, flags) * LANE_WIDTH) / 2 + SHOULDER;
}

/** Footpath beside the kerb on each side: streets have one, motorways, ramps, lanes and rail do not. */
export function footpathWidth(cls: number): number {
  const name = ROAD_CLASSES[cls];
  if (!name || name === 'rail' || name === 'service' || name.startsWith('motorway') || name.startsWith('trunk')) return 0;
  return name === 'living_street' ? 1.2 : 2;
}

/** Roads that carry a painted centre line when two-way: collector streets and up. */
export const centreLined = (cls: number) => cls >= code('tertiary') && cls !== RAIL;
/** Roads with painted edge lines and, at night, street lamps along them. */
export const arterial = (cls: number) => cls >= code('secondary') && cls !== RAIL;
