import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type MapMeta, decodeBuildings } from '../src/shared/mapFormat';
import { buildWorld, inflateIfGzip } from '../src/world/buildWorld';
import { CHUNK_SIZE, groupIntoChunks } from '../src/world/extrude';
import { OUTSKIRTS_FLOOR } from '../src/world/terrainMesh';

const dir = resolve(import.meta.dirname, '../public/map-fake');
const meta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')) as MapMeta;
const terrainBytes = () => new Uint8Array(readFileSync(resolve(dir, meta.terrain.file)));
const buildingBytes = () => new Uint8Array(readFileSync(resolve(dir, meta.buildings.file)));

describe('world geometry on the fake map', () => {
  it('chunks: every building lands in exactly one chunk, at most 64 chunks', async () => {
    const data = decodeBuildings(await inflateIfGzip(buildingBytes()));
    const groups = groupIntoChunks(data, meta.bounds, CHUNK_SIZE, 'high');
    const seen = new Uint8Array(data.count);
    for (const ids of groups.values()) for (const id of ids) seen[id]++;
    expect(seen.every((n) => n === 1)).toBe(true);
    expect(groups.size).toBeLessThanOrEqual(64);
  });

  it('buildWorld returns consistent geometry and a collision grid', async () => {
    const out = await buildWorld({
      terrain: terrainBytes(),
      buildings: buildingBytes(),
      bounds: meta.bounds,
      collisionCell: meta.collision.cell,
      waterLevel: meta.water.level,
      quality: 'high',
    });
    expect(out.buildingCount).toBe(meta.buildings.count);
    expect(out.chunks.reduce((n, c) => n + c.buildingCount, 0)).toBe(meta.buildings.count);
    for (const c of out.chunks) {
      expect(c.style.length / 4).toBe(c.positions.length / 3);
      const max = Math.max(...c.indices);
      expect(max).toBeLessThan(c.positions.length / 3);
      expect(c.indices.length % 3).toBe(0);
    }
    expect(out.terrain.cols).toBe(meta.terrain.cols);
    expect(out.terrainMesh.positions.length / 3).toBe(meta.terrain.cols * meta.terrain.rows);
    expect(out.grid.data.length).toBe(out.grid.cols * out.grid.rows);
  });

  it('draws every terrain cell that could be seen, and none that lies wholly under the sea', async () => {
    const out = await buildWorld({
      terrain: terrainBytes(),
      buildings: buildingBytes(),
      bounds: meta.bounds,
      collisionCell: meta.collision.cell,
      waterLevel: meta.water.level,
      quality: 'high',
    });
    const { cols, rows, heights } = out.terrain;
    const level = meta.water.level;
    let dry = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const h = [heights[r * cols + c], heights[r * cols + c + 1], heights[(r + 1) * cols + c], heights[(r + 1) * cols + c + 1]];
        if (h.some((v) => v >= level)) dry++;
      }
    }
    const m = out.terrainMesh;
    expect(m.indices.length / 6).toBe(dry);
    // The fake map has a harbour, so this is a real saving and not a no-op.
    expect(dry).toBeLessThan((cols - 1) * (rows - 1) * 0.95);
    expect(dry).toBeGreaterThan(0);
    // No triangle is entirely below the water.
    for (let i = 0; i < m.indices.length; i += 6) {
      const cell = [...m.indices.subarray(i, i + 6)].map((v) => m.positions[v * 3 + 1]);
      expect(cell.some((v) => v >= level)).toBe(true);
    }
    // The ring outside the map sinks below the sea, and the part that has is not drawn either.
    const o = out.outskirts;
    let ringCells = 0;
    for (let i = 0; i < o.indices.length; i += 6) {
      ringCells++;
      const cell = [...o.indices.subarray(i, i + 6)].map((v) => o.positions[v * 3 + 1]);
      expect(cell.some((v) => v >= level)).toBe(true);
    }
    expect(ringCells).toBeGreaterThan(0);
  });

  it('low quality drops buildings and decimates the terrain', async () => {
    const args = {
      terrain: terrainBytes(),
      buildings: buildingBytes(),
      bounds: meta.bounds,
      collisionCell: meta.collision.cell,
      waterLevel: meta.water.level,
    };
    const hi = await buildWorld({ ...args, quality: 'high' });
    const lo = await buildWorld({ ...args, terrain: terrainBytes(), buildings: buildingBytes(), quality: 'low' });
    const n = (o: typeof hi) => o.chunks.reduce((a, c) => a + c.buildingCount, 0);
    expect(n(lo)).toBeLessThanOrEqual(n(hi));
    expect(lo.terrainMesh.indices.length).toBeLessThan(hi.terrainMesh.indices.length);
    // the collision grid never changes with quality
    expect(lo.grid.data).toEqual(hi.grid.data);
    // Builds two full worlds; give it room when the whole suite runs in parallel.
  }, 180_000);

  it('outskirts leave a hole for the world rectangle and sink to the floor', async () => {
    const out = await buildWorld({
      terrain: terrainBytes(),
      buildings: buildingBytes(),
      bounds: meta.bounds,
      collisionCell: meta.collision.cell,
      waterLevel: meta.water.level,
      quality: 'high',
    });
    const o = out.outskirts;
    const b = meta.bounds;
    let minY = Infinity;
    for (let i = 0; i < o.positions.length; i += 3) minY = Math.min(minY, o.positions[i + 1]);
    expect(minY).toBeLessThanOrEqual(OUTSKIRTS_FLOOR + 1e-3);
    for (let i = 0; i < o.indices.length; i += 3) {
      const ids = [o.indices[i], o.indices[i + 1], o.indices[i + 2]];
      const cx = ids.reduce((s, v) => s + o.positions[v * 3], 0) / 3;
      const cz = ids.reduce((s, v) => s + o.positions[v * 3 + 2], 0) / 3;
      const insideX = cx > b.minX && cx < b.maxX;
      const insideZ = cz > b.minZ && cz < b.maxZ;
      expect(insideX && insideZ).toBe(false);
    }
  });
});
