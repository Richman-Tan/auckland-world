/**
 * The close-up detail, built from its own small files after the city is already on screen.
 * Pure (no DOM, no three); runs in the geometry worker.
 */
import { type Bounds, type TerrainGrid, decodeRoads } from '../shared/mapFormat';
import type { QualityTier } from '../shared/detail';
import { inflateIfGzip } from './buildWorld';
import { type RibbonMesh, buildRibbons, ribbonTransferables } from './ribbons';
import { sampleTerrainMesh } from './terrainMesh';

export interface DetailInput {
  /** roads.bin, gzipped or not; absent if the map has none. */
  roads?: Uint8Array;
  terrain: TerrainGrid;
  bounds: Bounds;
  quality: QualityTier;
}

export interface DetailOutput {
  ribbons?: RibbonMesh;
}

export async function buildDetail(input: DetailInput): Promise<DetailOutput> {
  const out: DetailOutput = {};
  // The same stride the terrain mesh was built with, so the roads lie on the ground as drawn.
  const stride = input.quality === 'low' ? 2 : 1;
  const heightAt = (x: number, z: number) => sampleTerrainMesh(input.terrain, x, z, stride);
  if (input.roads) {
    const roads = decodeRoads(await inflateIfGzip(input.roads));
    // The low tier leaves out service lanes: two fifths of the network, and the least missed.
    out.ribbons = buildRibbons(roads, heightAt, input.bounds, { minClass: input.quality === 'low' ? 1 : 0 });
  }
  return out;
}

export function detailTransferables(out: DetailOutput): ArrayBuffer[] {
  return out.ribbons ? ribbonTransferables(out.ribbons) : [];
}
