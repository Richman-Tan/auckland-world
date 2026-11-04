import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { placeStops } from '../src/app/placement';
import { content } from '../src/content/index';
import { buildCollisionGrid, createWorldQuery, landmarkColliders } from '../src/shared/collision';
import { type MapMeta, decodeBuildings, decodeTerrain, isMapMeta, sampleTerrain } from '../src/shared/mapFormat';

const dir = resolve(import.meta.dirname, '../public/map-fake');
const meta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')) as MapMeta;

describe('fake map', () => {
  it('has valid meta', () => {
    expect(isMapMeta(meta)).toBe(true);
  });

  const terrain = decodeTerrain(gunzipSync(readFileSync(resolve(dir, meta.terrain.file))));
  const buildings = decodeBuildings(gunzipSync(readFileSync(resolve(dir, meta.buildings.file))));

  it('decodes with counts matching meta', () => {
    expect(terrain.cols).toBe(meta.terrain.cols);
    expect(buildings.count).toBe(meta.buildings.count);
    expect(buildings.vertexCount).toBe(meta.buildings.vertices);
  });

  it('places every stop inside the world with margin, apart from each other', () => {
    const stops = placeStops(content, meta, (x, z) => sampleTerrain(terrain, x, z));
    for (const s of stops) {
      expect(s.x).toBeGreaterThan(meta.bounds.minX + 600);
      expect(s.x).toBeLessThan(meta.bounds.maxX - 600);
      expect(s.z).toBeGreaterThan(meta.bounds.minZ + 600);
      expect(s.z).toBeLessThan(meta.bounds.maxZ - 600);
    }
    for (const a of stops) for (const b of stops) {
      if (a.id >= b.id) continue;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.triggerRadius + b.triggerRadius);
    }
  });

  it('builds a world query with landmark colliders', () => {
    const grid = buildCollisionGrid(terrain, buildings, meta.bounds, meta.collision.cell);
    const world = createWorldQuery(terrain, grid, landmarkColliders(meta), meta.bounds);
    const st = meta.landmarks.skyTower;
    expect(world.hitCollider(st.x, st.groundY + 200, st.z, 2)?.name).toMatch(/Sky Tower/);
    const top = meta.landmarks.harbourBridge.archTop;
    expect(world.hitCollider(top.x, top.y - 1, top.z, 2)?.name).toMatch(/Harbour Bridge/);
  });
});
