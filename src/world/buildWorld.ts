/**
 * The heavy, DOM-free part of loading: inflate, decode, extrude, collision grid, terrain mesh.
 * Called from geometry.worker.ts; also runs in Node (tests).
 */
import { type CollisionGrid, buildCollisionGrid } from '../shared/collision';
import { type Bounds, type TerrainGrid, decodeBuildings, decodeTerrain, isGzip } from '../shared/mapFormat';
import { type ChunkGeometry, type QualityTier, extrudeBuildings } from './extrude';
import { type MeshArrays, buildOutskirtsMesh, buildTerrainMesh } from './terrainMesh';

export interface BuildInput {
  /** terrain.bin.gz as fetched (may or may not still be gzipped). */
  terrain: Uint8Array;
  buildings: Uint8Array;
  bounds: Bounds;
  collisionCell: number;
  waterLevel: number;
  quality: QualityTier;
}

export interface BuildOutput {
  terrain: TerrainGrid;
  terrainMesh: MeshArrays;
  outskirts: MeshArrays;
  chunks: ChunkGeometry[];
  grid: CollisionGrid;
  buildingCount: number;
}

export async function inflateIfGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function buildWorld(input: BuildInput): Promise<BuildOutput> {
  const terrain = decodeTerrain(await inflateIfGzip(input.terrain));
  const buildings = decodeBuildings(await inflateIfGzip(input.buildings));
  const stride = input.quality === 'low' ? 2 : 1;
  const terrainMesh = buildTerrainMesh(terrain, input.bounds, stride, input.waterLevel);
  const outskirts = buildOutskirtsMesh(terrain, input.bounds, input.waterLevel);
  const chunks = extrudeBuildings(buildings, { bounds: input.bounds, quality: input.quality });
  const grid = buildCollisionGrid(terrain, buildings, input.bounds, input.collisionCell, input.waterLevel);
  return { terrain, terrainMesh, outskirts, chunks, grid, buildingCount: buildings.count };
}

/** Everything that can be handed over to the main thread without a copy. */
export function transferables(out: BuildOutput): ArrayBuffer[] {
  const list: ArrayBuffer[] = [];
  const add = (a: { buffer: ArrayBufferLike }) => list.push(a.buffer as ArrayBuffer);
  add(out.terrain.heights);
  add(out.terrainMesh.positions);
  add(out.terrainMesh.uvs);
  add(out.terrainMesh.indices);
  add(out.outskirts.positions);
  add(out.outskirts.uvs);
  add(out.outskirts.indices);
  add(out.grid.data);
  for (const c of out.chunks) {
    add(c.positions);
    add(c.style);
    add(c.indices);
  }
  return list;
}
