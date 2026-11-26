/**
 * The close-up detail, built from its own small files after the city is already on screen.
 * Pure (no DOM, no three); runs in the geometry worker.
 */
import { landTexture } from '../shared/land';
import { type Bounds, type MapMeta, type TerrainGrid, decodeLand, decodeRoads } from '../shared/mapFormat';
import type { QualityTier } from '../shared/detail';
import { inflateIfGzip } from './buildWorld';
import { type RibbonMesh, bridgeStrips, buildRibbons, ribbonTransferables } from './ribbons';
import { type TreeField, scatterTrees, treeTransferables } from './trees';
import { sampleTerrainMesh } from './terrainMesh';

export interface DetailInput {
  /** roads.bin, gzipped or not; absent if the map has none. */
  roads?: Uint8Array;
  /** land.bin, gzipped or not; absent if the map has none. */
  land?: Uint8Array;
  /** The Harbour Bridge as measured, so its deck gets its lanes along with the roads. */
  bridge?: MapMeta['landmarks']['harbourBridge'];
  /** Sea level: nothing is planted at or below it. */
  waterLevel?: number;
  terrain: TerrainGrid;
  bounds: Bounds;
  quality: QualityTier;
}

/** The land grid as the terrain shader reads it: two bytes a cell (shared/land.ts, landTexture). */
export interface LandImage {
  width: number;
  height: number;
  cell: number;
  pixels: Uint8Array;
}

export interface DetailOutput {
  ribbons?: RibbonMesh;
  land?: LandImage;
  /** Trees, stood wherever the land grid says there is canopy. */
  trees?: TreeField;
}

export async function buildDetail(input: DetailInput): Promise<DetailOutput> {
  const out: DetailOutput = {};
  // The same stride the terrain mesh was built with, so the roads lie on the ground as drawn.
  const stride = input.quality === 'low' ? 2 : 1;
  const heightAt = (x: number, z: number) => sampleTerrainMesh(input.terrain, x, z, stride);
  if (input.roads) {
    const roads = decodeRoads(await inflateIfGzip(input.roads));
    // The low tier leaves out service lanes: two fifths of the network, and the least missed.
    out.ribbons = buildRibbons(roads, heightAt, input.bounds, {
      minClass: input.quality === 'low' ? 1 : 0,
      strips: input.bridge ? bridgeStrips(input.bridge) : [],
    });
  }
  if (input.land) {
    const grid = decodeLand(await inflateIfGzip(input.land));
    out.land = { width: grid.width, height: grid.height, cell: grid.cell, pixels: landTexture(grid) };
    out.trees = scatterTrees(grid, input.bounds, heightAt, { waterLevel: input.waterLevel ?? 0 });
  }
  return out;
}

export function detailTransferables(out: DetailOutput): ArrayBuffer[] {
  const list = out.ribbons ? ribbonTransferables(out.ribbons) : [];
  if (out.land) list.push(out.land.pixels.buffer as ArrayBuffer);
  if (out.trees) list.push(...treeTransferables(out.trees));
  return list;
}
