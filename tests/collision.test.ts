import { describe, expect, it } from 'vitest';
import { buildCollisionGrid, createWorldQuery } from '../src/shared/collision';
import { decodeBuildings, encodeBuildings } from '../src/shared/mapFormat';

describe('collision grid', () => {
  const heights = new Float32Array(11 * 11).fill(10);
  const terrain = { cols: 11, rows: 11, cell: 20, x0: -100, z0: -100, minH: 10, maxH: 10, heights };
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const buildings = decodeBuildings(
    encodeBuildings([{ rings: [[0, 0, 30, 0, 30, -30, 0, -30]], baseY: 8, topY: 55, style: 0 }]),
  );
  const grid = buildCollisionGrid(terrain, buildings, bounds, 6);
  const world = createWorldQuery(terrain, grid, [{ kind: 'cylinder', name: 'pole', x: -50, z: -50, y0: 0, y1: 100, r: 3 }], bounds);

  it('raises cells under buildings to their tops', () => {
    expect(world.solidAt(15, -15)).toBeCloseTo(55, 1);
    expect(world.solidAt(-60, 60)).toBeCloseTo(10, 1);
  });

  it('includes cells whose centre is within 1.5 m of a footprint', () => {
    // Cell spanning x 30..36 has centre 33: outside by 3 m, so it stays at ground.
    expect(world.solidAt(34, -15)).toBeCloseTo(10, 1);
  });

  it('hits analytic colliders', () => {
    expect(world.hitCollider(-50, 50, -48, 1)?.name).toBe('pole');
    expect(world.hitCollider(-50, 150, -50, 1)).toBeNull();
    expect(world.hitCollider(-40, 50, -50, 1)).toBeNull();
  });
});
