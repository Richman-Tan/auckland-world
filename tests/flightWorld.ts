/** Test helper: load a built map directory into a WorldQuery, exactly as the runtime does. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { placeStops } from '../src/app/placement';
import { content } from '../src/content/index';
import { buildCollisionGrid, createWorldQuery, landmarkColliders } from '../src/shared/collision';
import { type MapMeta, decodeBuildings, decodeTerrain } from '../src/shared/mapFormat';

export const FAKE_DIR = resolve(import.meta.dirname, '../public/map-fake');
export const REAL_DIR = resolve(import.meta.dirname, '../public/map');
export const realMapExists = existsSync(resolve(REAL_DIR, 'meta.json'));

export function loadWorld(dir: string) {
  const meta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')) as MapMeta;
  const terrain = decodeTerrain(gunzipSync(readFileSync(resolve(dir, meta.terrain.file))));
  const buildings = decodeBuildings(gunzipSync(readFileSync(resolve(dir, meta.buildings.file))));
  // As the site builds it: the landmarks' own buildings left out, the port's containers in.
  const grid = buildCollisionGrid(terrain, buildings, meta.bounds, meta.collision.cell, meta.water.level, meta.landmarks);
  const world = createWorldQuery(terrain, grid, landmarkColliders(meta), meta.bounds, meta.water.level);
  const stops = placeStops(content, meta, world.groundAt);
  return { meta, terrain, buildings, grid, world, stops };
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
