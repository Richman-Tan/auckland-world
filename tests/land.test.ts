import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dilate, fillPolygon, stampLine } from '../scripts/lib/raster';
import { LAND_LIB, LAND_UNIFORMS } from '../src/render/groundChunks';
import {
  CANOPY_HEIGHTS,
  CANOPY_LOW,
  CANOPY_MID,
  CANOPY_NONE,
  CANOPY_TALL,
  CANOPY_TYPICAL,
  LAND_CELL,
  LAND_CLASSES,
  LAND_COLOUR,
  type LandGrid,
  canopyClass,
  landCellAt,
  landCode,
  landTexture,
  voteClass,
} from '../src/shared/land';
import { type MapMeta, decodeLand, decodeTerrain, encodeLand, latLonToLocal } from '../src/shared/mapFormat';
import { GROUND } from '../src/shared/palette';
import { buildDetail, detailTransferables } from '../src/world/buildDetail';
import { rng } from './flightWorld';

describe('land tables', () => {
  it('has a ground-image colour for every class, and fits its codes in four bits', () => {
    expect(LAND_CLASSES.length).toBeLessThanOrEqual(16);
    for (const k of LAND_CLASSES) expect(GROUND[LAND_COLOUR[k]], k).toMatch(/^#[0-9a-f]{6}$/);
    expect(landCode('land')).toBe(0);
    expect(new Set(LAND_CLASSES).size).toBe(LAND_CLASSES.length);
  });

  it('sorts tree heights into none, low, middle and tall', () => {
    expect(canopyClass(0)).toBe(CANOPY_NONE);
    expect(canopyClass(CANOPY_HEIGHTS[0] - 0.01)).toBe(CANOPY_NONE);
    expect(canopyClass(CANOPY_HEIGHTS[0])).toBe(CANOPY_LOW);
    expect(canopyClass(CANOPY_HEIGHTS[1])).toBe(CANOPY_MID);
    expect(canopyClass(CANOPY_HEIGHTS[2])).toBe(CANOPY_TALL);
    expect(canopyClass(NaN)).toBe(CANOPY_NONE);
    // The height a tree is given stands inside its class.
    for (const k of [CANOPY_LOW, CANOPY_MID, CANOPY_TALL]) expect(canopyClass(CANOPY_TYPICAL[k])).toBe(k);
  });

  it('finds the cell under a point, and nothing outside the grid', () => {
    const g = { width: 10, height: 5, cell: 6 };
    expect(landCellAt(g, -30, -15, -30, -15)).toBe(0);
    expect(landCellAt(g, -30, -15, -24.01, -15)).toBe(0);
    expect(landCellAt(g, -30, -15, -24, -9)).toBe(11);
    expect(landCellAt(g, -30, -15, 29.9, 14.9)).toBe(49);
    expect(landCellAt(g, -30, -15, 30, 0)).toBe(-1);
    expect(landCellAt(g, -30, -15, 0, -15.1)).toBe(-1);
  });
});

describe('the class vote', () => {
  it('is the cell itself at a cell centre, and unanimous cells always win', () => {
    expect(voteClass(3, 5, 7, 9, 0, 0)).toBe(3);
    expect(voteClass(3, 5, 7, 9, 1, 0)).toBe(5);
    expect(voteClass(3, 5, 7, 9, 0, 1)).toBe(7);
    expect(voteClass(3, 5, 7, 9, 1, 1)).toBe(9);
    const random = rng(4);
    for (let i = 0; i < 200; i++) expect(voteClass(6, 6, 6, 6, random(), random())).toBe(6);
  });

  it('draws a straight boundary straight, half way between the cells', () => {
    // Left column grass, right column sand: the boundary is the vertical line fx = 0.5 at any fy.
    for (const fy of [0, 0.2, 0.5, 0.9, 1]) {
      expect(voteClass(5, 9, 5, 9, 0.49, fy)).toBe(5);
      expect(voteClass(5, 9, 5, 9, 0.51, fy)).toBe(9);
    }
  });

  it('rounds a corner instead of stepping round it', () => {
    // One sand cell among three of grass: sand holds less than its own quarter of the square.
    let sand = 0;
    const n = 100;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (voteClass(5, 5, 5, 9, (i + 0.5) / n, (j + 0.5) / n) === 9) sand++;
    expect(sand / (n * n)).toBeGreaterThan(0.1);
    expect(sand / (n * n)).toBeLessThan(0.25);
    // And it is the corner region: wherever sand wins, it also wins further into its corner.
    expect(voteClass(5, 5, 5, 9, 0.8, 0.8)).toBe(9);
    expect(voteClass(5, 5, 5, 9, 0.6, 0.6)).toBe(5);
  });

  it('always returns one of the four, whatever the position', () => {
    const random = rng(11);
    for (let i = 0; i < 500; i++) {
      const c = [0, 1, 2, 3].map(() => Math.floor(random() * 4));
      expect(c).toContain(voteClass(c[0], c[1], c[2], c[3], random(), random()));
    }
  });

  it('is what the shader does: the same weights and the same tie order', () => {
    // The GLSL copy cannot be run here, so hold it to the shape of this one.
    expect(LAND_LIB).toContain('float s00 = w00 + (c10 == c00 ? w10 : 0.0) + (c01 == c00 ? w01 : 0.0) + (c11 == c00 ? w11 : 0.0);');
    expect(LAND_LIB).toContain('if (s10 > top) { best = c10; top = s10; }');
    expect(LAND_UNIFORMS).toContain(`uniform vec3 uLandCol[${LAND_CLASSES.length}];`);
    // Each class the shader paints specially is named by its current code.
    for (const k of ['park', 'pitch', 'wood', 'scrub', 'sand', 'rock', 'water', 'parking', 'residential', 'commercial', 'industrial'] as const) {
      expect(LAND_LIB, k).toContain(`cls == ${landCode(k)}`);
    }
  });
});

describe('land.bin', () => {
  const grid = (w: number, h: number, seed: number): LandGrid => {
    const random = rng(seed);
    const cls = new Uint8Array(w * h);
    const canopy = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      cls[i] = Math.floor(random() * LAND_CLASSES.length);
      canopy[i] = Math.floor(random() * 4);
    }
    return { width: w, height: h, cell: LAND_CELL, cls, canopy };
  };

  it('round-trips a grid exactly, whatever its width', () => {
    for (const [w, h] of [[1, 1], [7, 3], [64, 9], [33, 50]]) {
      const g = grid(w, h, w * 31 + h);
      const back = decodeLand(encodeLand(g));
      expect(back.width).toBe(w);
      expect(back.height).toBe(h);
      expect(back.cell).toBe(LAND_CELL);
      expect(Array.from(back.cls)).toEqual(Array.from(g.cls));
      expect(Array.from(back.canopy)).toEqual(Array.from(g.canopy));
    }
  });

  it('stores rows as their difference from the row above, so flat land is nearly all zeros', () => {
    const g: LandGrid = { width: 40, height: 30, cell: 6, cls: new Uint8Array(1200).fill(landCode('park')), canopy: new Uint8Array(1200).fill(CANOPY_MID) };
    const bytes = encodeLand(g);
    let nonZero = 0;
    for (let i = 16; i < bytes.length; i++) if (bytes[i]) nonZero++;
    expect(nonZero).toBe(80); // only the first row of each plane
    expect(Array.from(decodeLand(bytes).cls)).toEqual(Array.from(g.cls));
  });

  it('refuses a file that is cut short, mislabelled or the wrong size', () => {
    const bytes = encodeLand(grid(12, 12, 5));
    expect(() => decodeLand(bytes.slice(0, bytes.length - 8))).toThrow(/Truncated/);
    const bad = bytes.slice();
    bad[0] = 0x58;
    expect(() => decodeLand(bad)).toThrow(/magic/);
    expect(() => encodeLand({ width: 4, height: 4, cell: 6, cls: new Uint8Array(15), canopy: new Uint8Array(16) })).toThrow(/planes/);
  });

  it('lays the grid out for the shader: class, then canopy there or not', () => {
    const g: LandGrid = { width: 2, height: 1, cell: 6, cls: Uint8Array.of(5, 9), canopy: Uint8Array.of(0, CANOPY_TALL) };
    expect(Array.from(landTexture(g))).toEqual([5, 0, 9, 255]);
  });
});

describe('painting classes into a grid', () => {
  it('fills exactly the cells whose centres are inside, and leaves a hole empty', () => {
    const g = new Uint8Array(100);
    const n = fillPolygon(g, 10, 10, [[2, 2, 8, 2, 8, 8, 2, 8], [4, 4, 6, 4, 6, 6, 4, 6]], 7);
    expect(n).toBe(36 - 4);
    expect(g[2 * 10 + 2]).toBe(7);
    expect(g[7 * 10 + 7]).toBe(7);
    expect(g[8 * 10 + 8]).toBe(0);
    expect(g[4 * 10 + 4]).toBe(0); // the hole
    expect(g[1 * 10 + 5]).toBe(0);
  });

  it('clips to the grid and ignores shapes that miss every centre', () => {
    const g = new Uint8Array(16);
    expect(fillPolygon(g, 4, 4, [[-5, -5, 2, -5, 2, 2, -5, 2]], 1)).toBe(4);
    expect(fillPolygon(g, 4, 4, [[2.1, 2.1, 2.4, 2.1, 2.4, 2.4, 2.1, 2.4]], 2)).toBe(0);
    expect(Array.from(g)).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('paints a triangle with half its square, to within the edge cells', () => {
    const g = new Uint8Array(40 * 40);
    const n = fillPolygon(g, 40, 40, [[0, 0, 40, 0, 0, 40]], 1);
    expect(Math.abs(n - 800)).toBeLessThanOrEqual(40);
  });

  it('stamps a line as wide as asked, with round ends', () => {
    const g = new Uint8Array(20 * 20);
    stampLine(g, 20, 20, [4, 10, 16, 10], 1.6, 3);
    // Across: rows whose centres are within 1.6 of y = 10, which is rows 8 to 11.
    for (const r of [8, 9, 10, 11]) expect(g[r * 20 + 10], `row ${r}`).toBe(3);
    expect(g[7 * 20 + 10]).toBe(0);
    expect(g[12 * 20 + 10]).toBe(0);
    // Along: the end is a half circle, so it reaches a cell and a half past the last point and no more.
    expect(g[10 * 20 + 2]).toBe(3);
    expect(g[10 * 20 + 1]).toBe(0);
    expect(g[8 * 20 + 2]).toBe(0);
  });

  it('grows a mask by a margin in every direction', () => {
    const g = new Uint8Array(81);
    g[4 * 9 + 4] = 1;
    const out = dilate(g, 9, 9, 2);
    let set = 0;
    for (const v of out) set += v;
    expect(set).toBe(25);
    expect(out[2 * 9 + 2]).toBe(1);
    expect(out[1 * 9 + 4]).toBe(0);
  });
});

describe('the land grid on the fake map', () => {
  const dir = new URL('../public/map-fake/', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8')) as MapMeta;
  const bytes = () => new Uint8Array(readFileSync(new URL(meta.detail!.land!.file, dir)));
  const land = decodeLand(new Uint8Array(gunzipSync(bytes())));

  it('is listed the way the real map lists it and covers the map', () => {
    expect(meta.detail?.land).toEqual({ file: 'land.bin.gz', width: land.width, height: land.height, cell: land.cell });
    expect(meta.files['land.bin.gz'].bytes).toBe(bytes().length);
    expect(land.width * land.cell).toBeGreaterThanOrEqual(meta.bounds.maxX - meta.bounds.minX);
    expect(land.height * land.cell).toBeGreaterThanOrEqual(meta.bounds.maxZ - meta.bounds.minZ);
  });

  it('says park where the picture paints one, with trees in it and none in the harbour', () => {
    const at = (lat: number, lon: number) => {
      const p = latLonToLocal(meta.geo, lat, lon);
      return landCellAt(land, meta.bounds.minX, meta.bounds.minZ, p.x, p.z);
    };
    expect(LAND_CLASSES[land.cls[at(-36.8767, 174.7643)]]).toBe('park'); // Mt Eden
    expect(LAND_CLASSES[land.cls[at(-36.85, 174.74)]]).toBe('land');
    let parkTrees = 0;
    let park = 0;
    for (let i = 0; i < land.cls.length; i++) {
      if (land.cls[i] !== landCode('park')) continue;
      park++;
      if (land.canopy[i]) parkTrees++;
    }
    expect(park).toBeGreaterThan(1000);
    expect(parkTrees / park).toBeGreaterThan(0.1);
    // Mid-harbour, between the fake map's two shores.
    const sea = landCellAt(land, meta.bounds.minX, meta.bounds.minZ, 0, -2100);
    expect(land.canopy[sea]).toBe(CANOPY_NONE);
  });

  it('reaches the scene as a two-channel image, built in the worker from the gzipped file', async () => {
    const terrain = decodeTerrain(new Uint8Array(gunzipSync(readFileSync(new URL(meta.terrain.file, dir)))));
    const out = await buildDetail({ land: bytes(), terrain, bounds: meta.bounds, quality: 'high' });
    expect(out.ribbons).toBeUndefined();
    expect(out.land).toBeDefined();
    const img = out.land!;
    expect([img.width, img.height, img.cell]).toEqual([land.width, land.height, land.cell]);
    expect(img.pixels.length).toBe(land.width * land.height * 2);
    expect(Array.from(img.pixels.subarray(0, 200))).toEqual(Array.from(landTexture(land).subarray(0, 200)));
    // Handed over without a copy, along with the trees that are stood from the same grid.
    expect(detailTransferables(out)).toContain(img.pixels.buffer);
    expect(out.trees).toBeDefined();
  });
});

const realDir = new URL('../public/map/', import.meta.url);
describe.runIf(existsSync(new URL('land.bin.gz', realDir)))('the land grid on the real map', () => {
  const meta = JSON.parse(readFileSync(new URL('meta.json', realDir), 'utf8')) as MapMeta;
  const land = decodeLand(new Uint8Array(gunzipSync(readFileSync(new URL('land.bin.gz', realDir)))));
  const classAt = (lat: number, lon: number) => {
    const p = latLonToLocal(meta.geo, lat, lon);
    return LAND_CLASSES[land.cls[landCellAt(land, meta.bounds.minX, meta.bounds.minZ, p.x, p.z)]];
  };

  it('knows a park, a pitch and the port for what they are', () => {
    expect(['park', 'wood', 'pitch']).toContain(classAt(-36.859, 174.7755)); // Auckland Domain
    expect(classAt(-36.8437, 174.785)).toBe('industrial'); // the container terminal
    expect(['park', 'wood', 'scrub']).toContain(classAt(-36.8767, 174.7643)); // Mt Eden
  });

  it('has trees over about a fifth of the land and only valid values', () => {
    let canopy = 0;
    for (let i = 0; i < land.cls.length; i++) {
      expect(land.cls[i]).toBeLessThan(LAND_CLASSES.length);
      expect(land.canopy[i]).toBeLessThanOrEqual(CANOPY_TALL);
      if (land.canopy[i]) canopy++;
    }
    // Of every cell, sea included (about a third of the map is sea).
    const share = canopy / land.cls.length;
    expect(share).toBeGreaterThan(0.06);
    expect(share).toBeLessThan(0.2);
  });
});
