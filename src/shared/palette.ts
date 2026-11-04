/**
 * One palette for the whole world: the pipeline paints the ground with it and picks building
 * style bytes from it; the runtime feeds the same colours to the shaders and the HUD.
 * Auckland, late afternoon: harbour teal, pōhutukawa red, kōwhai yellow, volcanic greens,
 * weatherboard villas and corrugated-iron roofs.
 */

export const ACCENTS = {
  pohutukawa: '#d7263d',
  kowhai: '#f2c230',
  harbour: '#2a9d8f',
  cream: '#f4ecd8',
  volcanic: '#6f9a4a',
} as const;

export type PaletteKey = keyof typeof ACCENTS;

/**
 * Wall palette (style byte low nibble). Index meaning is part of the contract:
 * the pipeline chooses by building type/height, the shader looks the colour up.
 */
export const WALL_PALETTE: readonly string[] = [
  '#8fa3a8', // 0  CBD glass, teal-grey
  '#6f8a94', // 1  CBD glass, darker
  '#a9b4b0', // 2  CBD glass, pale
  '#c9c2b4', // 3  concrete, warm
  '#b3aea4', // 4  concrete, cool
  '#d9d2c3', // 5  render, light
  '#f1ece0', // 6  weatherboard white
  '#e9dfc4', // 7  weatherboard cream
  '#d8e2d5', // 8  villa pastel, mint
  '#e6d3cf', // 9  villa pastel, blush
  '#cfdbe3', // 10 villa pastel, sky
  '#a8644e', // 11 brick, red
  '#8b6a55', // 12 brick, brown
  '#9a9a8e', // 13 industrial cladding
  '#c7b38d', // 14 sandstone / heritage
  '#5f6b70', // 15 dark cladding
];

/** Roof palette (style byte high nibble). */
export const ROOF_PALETTE: readonly string[] = [
  '#b23a3a', // 0  corrugated iron, red
  '#4f6f4a', // 1  corrugated iron, green
  '#3a3d42', // 2  corrugated iron, charcoal
  '#7c8287', // 3  corrugated iron, grey
  '#8a5a44', // 4  terracotta tile
  '#9fa3a3', // 5  flat concrete, light
  '#878b8c', // 6  flat concrete, mid
  '#6d7173', // 7  flat concrete, dark
  '#56707a', // 8  glass roof
  '#a9a08e', // 9  gravel
  '#2f5f63', // 10 teal metal
  '#c2c0b6', // 11 membrane, pale
  '#7a5d4e', // 12 scoria / brown
  '#5c6450', // 13 green roof
  '#b9a77f', // 14 heritage copper-sand
  '#44484c', // 15 plant room dark
];

export function wallIndex(style: number): number {
  return style & 0x0f;
}
export function roofIndex(style: number): number {
  return (style >> 4) & 0x0f;
}
export function makeStyle(wall: number, roof: number): number {
  return ((roof & 0x0f) << 4) | (wall & 0x0f);
}

/** Sky, fog and light. The sun comes from the north-west (the southern-hemisphere afternoon). */
export const SKY = {
  zenith: '#3e7f95',
  horizon: '#f2d6b3',
  sun: '#fff1c9',
  /** Azimuth measured clockwise from north, degrees. */
  sunAzimuthDeg: 315,
  sunAltitudeDeg: 40,
} as const;

export const WATER = {
  deep: '#1f6f78',
  shallow: '#2a8c8c',
  foam: '#e9f3ea',
  sparkle: '#fff7dd',
} as const;

/** Ground texture layer colours (pipeline). */
export const GROUND = {
  land: '#d8cdb2',
  residential: '#cfc5ab',
  commercial: '#d6bea4',
  industrial: '#bdb7ad',
  park: '#6f9a4a',
  pitch: '#86ad57',
  wood: '#3f6431',
  scrub: '#557d3c',
  sand: '#e8d9a8',
  rock: '#7a5d4e',
  roadCasing: '#2f2f35',
  road: '#55555c',
  motorway: '#6b5f58',
  rail: '#4a3f3a',
  footprint: '#a89f8f',
  footprintShadow: '#8c8476',
  inlandWater: '#2a8c8c',
  foam: '#e9f3ea',
  minimapSea: '#1f6f78',
} as const;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
